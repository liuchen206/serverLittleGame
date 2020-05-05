var roomMgr = require("./roommgr");
var userMgr = require("./usermgr");
var mjutils = require('./mjutils');
var db = require("../utils/db");
var crypto = require("../utils/crypto");
var games = {};
var gamesIdBase = 0;

var ACTION_CHUPAI = 1;
var ACTION_MOPAI = 2;
var ACTION_PENG = 3;
var ACTION_GANG = 4;
var ACTION_HU = 5;
var ACTION_ZIMO = 6;

var gameSeatsOfUsers = {};

exports.hasBegan = function (roomId) {
    var game = games[roomId];
    if (game != null) {
        return true;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo != null) {
        return roomInfo.numOfGames > 0;
    }
    return false;
};

exports.setReady = function (userId, callback) {
    var roomId = roomMgr.getUserRoom(userId);
    console.log("xzdd setReady  roomId ", roomId)

    if (roomId == null) {
        return;
    }

    var roomInfo = roomMgr.getRoom(roomId);
    console.log("xzdd setReady roomInfo", roomInfo)

    if (roomInfo == null) {
        return;
    }

    roomMgr.setReady(userId, true);

    var game = games[roomId];
    console.log("xzdd setReady game", game)

    if (game == null) {
        if (roomInfo.seats.length == 4) {
            var bingoCounter = 0;
            for (var i = 0; i < roomInfo.seats.length; ++i) {
                var s = roomInfo.seats[i];
                if (s.ready == true && userMgr.isOnline(s.userId) == true) {
                    bingoCounter++;
                }
            }
            //人到齐了，并且都准备好了，则开始新的一局
            console.log("有几个人准备好了 ", bingoCounter, "需要几人 ", roomInfo.conf.playerNum);
            if (bingoCounter == roomInfo.conf.playerNum) {
                console.log("mj begin");
                exports.begin(roomId);
            } else {
                console.log('人数不满足开始游戏的条件');
            }
        }
    } else {
        // 处理游戏开始后
        var numOfMJ = game.mahjongs.length - game.currentIndex;
        var remainingGames = roomInfo.conf.maxGames - roomInfo.numOfGames; // 剩余局数

        var data = {
            state: game.state,
            numofmj: numOfMJ,
            button: game.button,
            turn: game.turn,
            chuPai: game.chuPai,
            huanpaimethod: game.huanpaiMethod,
            serverType: 'mj'
        };

        data.seats = [];
        var seatData = null;
        for (var i = 0; i < 4; ++i) {
            var sd = game.gameSeats[i];

            var s = {
                userid: sd.userId,
                folds: sd.folds,
                angangs: sd.angangs,
                diangangs: sd.diangangs,
                wangangs: sd.wangangs,
                pengs: sd.pengs,
                que: sd.que,
                hued: sd.hued,
                iszimo: sd.iszimo,
            }
            if (sd.userId == userId) {
                s.holds = sd.holds;
                s.huanpais = sd.huanpais;
                seatData = sd;
            }
            else {
                s.huanpais = sd.huanpais ? [] : null;
            }
            data.seats.push(s);
        }

        //同步整个信息给客户端
        userMgr.sendMsg(userId, 'game_sync_push', data);
        sendOperations(game, seatData, game.chuPai);
    }
};
//开始新的一局
exports.begin = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return;
    }
    var seats = roomInfo.seats;

    // 游戏运行环境
    var game = {
        conf: roomInfo.conf,
        roomInfo: roomInfo,
        gameIndex: roomInfo.numOfGames,

        button: roomInfo.nextButton,
        mahjongs: new Array(108),
        currentIndex: 0,
        gameSeats: new Array(4),

        numOfQue: 0,
        turn: 0,
        chuPai: -1,
        state: "idle",
        firstHupai: -1,
        yipaoduoxiang: -1,
        fangpaoshumu: -1,
        actionList: [],
        hupaiList: [],
        chupaiCnt: 0,
    };

    roomInfo.numOfGames++;

    for (var i = 0; i < game.gameSeats.length; ++i) {
        var data = game.gameSeats[i] = {}; // 初始化一个座位上的玩家信息

        data.game = game;

        data.seatIndex = i;

        data.userId = seats[i].userId;
        //持有的牌
        data.holds = [];
        //打出的牌
        data.folds = [];
        //暗杠的牌
        data.angangs = [];
        //点杠的牌
        data.diangangs = [];
        //弯杠的牌
        data.wangangs = [];
        //碰了的牌
        data.pengs = [];
        //缺一门
        data.que = -1;

        //换三张的牌
        data.huanpais = null;

        //玩家手上的牌的数目，用于快速判定碰杠
        data.countMap = {};
        //玩家听牌，用于快速判定胡了的番数
        data.tingMap = {};
        data.pattern = "";

        //是否可以杠
        data.canGang = false;
        //用于记录玩家可以杠的牌
        data.gangPai = [];

        //是否可以碰
        data.canPeng = false;
        //是否可以胡
        data.canHu = false;
        //是否可以出牌
        data.canChuPai = false;

        //如果guoHuFan >=0 表示处于过胡状态，
        //如果过胡状态，那么只能胡大于过胡番数的牌
        data.guoHuFan = -1;

        //是否胡了
        data.hued = false;
        //是否是自摸
        data.iszimo = false;

        data.isGangHu = false;

        //
        data.actions = [];

        data.fan = 0;
        data.score = 0;
        data.lastFangGangSeat = -1;

        //统计信息
        data.numZiMo = 0;
        data.numJiePao = 0;
        data.numDianPao = 0;
        data.numAnGang = 0;
        data.numMingGang = 0;
        data.numChaJiao = 0;

        gameSeatsOfUsers[data.userId] = data;
    }
    games[roomId] = game;
    //洗牌
    shuffle(game);
    //发牌
    deal(game);

    var numOfMJ = game.mahjongs.length - game.currentIndex;
    var huansanzhang = roomInfo.conf.hsz;

    for (var i = 0; i < roomInfo.conf.playerNum; ++i) {
        //开局时，通知前端必要的数据
        var s = seats[i];
        //通知玩家手牌
        userMgr.sendMsg(s.userId, 'game_holds_push', game.gameSeats[i].holds);
        //通知还剩多少张牌
        userMgr.sendMsg(s.userId, 'mj_count_push', numOfMJ);
        //通知还剩多少局
        userMgr.sendMsg(s.userId, 'game_num_push', roomInfo.numOfGames);
        //通知游戏开始
        userMgr.sendMsg(s.userId, 'game_begin_push', game.button);

        if (huansanzhang == true) { // 总是为false
            game.state = "huanpai";
            //通知准备换牌
            userMgr.sendMsg(s.userId, 'game_huanpai_push');
        } else {
            game.state = "dingque";
            //通知准备定缺
            userMgr.sendMsg(s.userId, 'game_dingque_push');
        }
    }
};

function shuffle(game) {
    /**
     * 筒子：36
     * 条子：36
     * 万字：36
     * 中发白：4*4 = 16
     * 晃晃：124总共；发牌后124-52-1=71，就算两个人打最多35轮摸牌
     * 四川：没有中发白共计108；发牌后108-52-1=55 就算两个人打最多25轮摸牌
     */
    var mahjongs = game.mahjongs;
    //筒 (0 ~ 8 表示筒子
    var index = 0;
    for (var i = 0; i < 9; ++i) { // 总共有9张类型 1-9 筒
        for (var c = 0; c < 4; ++c) { // 每个类型总共有4个一样的
            mahjongs[index] = i;
            index++;
        }
    }

    //条 9 ~ 17表示条子
    for (var i = 9; i < 18; ++i) {
        for (var c = 0; c < 4; ++c) {
            mahjongs[index] = i;
            index++;
        }
    }

    //万
    //条 18 ~ 26表示万
    for (var i = 18; i < 27; ++i) {
        for (var c = 0; c < 4; ++c) {
            mahjongs[index] = i;
            index++;
        }
    }

    for (var i = 0; i < mahjongs.length; ++i) {
        var lastIndex = mahjongs.length - 1 - i;
        var index = Math.floor(Math.random() * lastIndex);
        var t = mahjongs[index];
        mahjongs[index] = mahjongs[lastIndex];
        mahjongs[lastIndex] = t;
    }
}
function deal(game) {
    //强制清0
    game.currentIndex = 0;
    //玩家数量
    var playNum = game.roomInfo.conf.playerNum;

    //每人13张 一共 13*4 ＝ 52张 庄家多一张 53张
    var seatIndex = game.button;
    var mopaiNum = 13 * playNum;
    console.log('开始派牌', '玩家数量==', playNum, '派牌总数==', mopaiNum, '庄家座位==', seatIndex);
    for (var i = 0; i < mopaiNum; ++i) {
        var mahjongs = game.gameSeats[seatIndex].holds;
        if (mahjongs == null) {
            mahjongs = [];
            game.gameSeats[seatIndex].holds = mahjongs;
        }
        mopai(game, seatIndex);
        seatIndex++;
        seatIndex %= playNum;
    }

    //庄家多摸最后一张
    mopai(game, game.button);
    //当前轮设置为庄家
    game.turn = game.button;
}
function mopai(game, seatIndex) {
    if (game.currentIndex == game.mahjongs.length) {
        return -1;
    }
    var data = game.gameSeats[seatIndex];
    var mahjongs = data.holds;
    var pai = game.mahjongs[game.currentIndex];
    mahjongs.push(pai);

    //统计牌的数目 ，用于快速判定（空间换时间）
    var c = data.countMap[pai];
    if (c == null) {
        c = 0;
    }
    data.countMap[pai] = c + 1;
    game.currentIndex++;
    return pai;
}
exports.dingQue = function (userId, type) {
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) {
        console.log("can't find user game data.");
        return;
    }

    var game = seatData.game;
    if (game.state != "dingque") {
        console.log("can't recv dingQue when game.state == " + game.state);
        return;
    }

    if (seatData.que < 0) {
        game.numOfQue++;
    }

    seatData.que = type;


    //检查玩家可以做的动作
    var playNum = game.conf.playerNum; // 玩家人数
    console.log('单个玩家定缺，总玩家数==', playNum, '总定缺数', game.numOfQue);
    //如果4个人都定缺了，通知庄家出牌
    if (game.numOfQue == playNum) {
        construct_game_base_info(game);
        var arr = [1, 1, 1, 1];
        for (var i = 0; i < game.gameSeats.length; ++i) {
            arr[i] = game.gameSeats[i].que;
        }
        userMgr.broacastInRoom('game_dingque_finish_push', arr, seatData.userId, true);
        userMgr.broacastInRoom('game_playing_push', null, seatData.userId, true);

        //进行听牌检查
        for (var i = 0; i < game.gameSeats.length; ++i) {
            var duoyu = -1;
            var gs = game.gameSeats[i];
            if (gs.holds.length == 14) {
                duoyu = gs.holds.pop();
                gs.countMap[duoyu] -= 1;
            }
            checkCanTingPai(game, gs);
            if (duoyu >= 0) {
                gs.holds.push(duoyu);
                gs.countMap[duoyu]++;
            }
        }

        var turnSeat = game.gameSeats[game.turn];
        game.state = "playing";
        //通知玩家出牌方
        turnSeat.canChuPai = true;
        userMgr.broacastInRoom('game_chupai_push', turnSeat.userId, turnSeat.userId, true);
        //检查是否可以暗杠或者胡
        //直杠
        checkCanAnGang(game, turnSeat);
        //检查胡 用最后一张来检查
        checkCanHu(game, turnSeat, turnSeat.holds[turnSeat.holds.length - 1]);
        //通知前端
        sendOperations(game, turnSeat, game.chuPai);
    }
    else {
        userMgr.broacastInRoom('game_dingque_notify_push', seatData.userId, seatData.userId, true);
    }
};
function recordGameAction(game, si, action, pai) {
    game.actionList.push(si);
    game.actionList.push(action);
    if (pai != null) {
        game.actionList.push(pai);
    }
}
//检查听牌
function checkCanTingPai(game, seatData) {
    seatData.tingMap = {};

    //检查手上的牌是不是已打缺，如果未打缺，则不进行判定
    for (var i = 0; i < seatData.holds.length; ++i) {
        var pai = seatData.holds[i];
        if (getMJType(pai) == seatData.que) {
            return;
        }
    }

    //检查是否是七对 前提是没有碰，也没有杠 ，即手上拥有13张牌
    if (seatData.holds.length == 13) {
        //有5对牌
        var hu = false;
        var danPai = -1;
        var pairCount = 0;
        for (var k in seatData.countMap) {
            var c = seatData.countMap[k];
            if (c == 2 || c == 3) {
                pairCount++;
            }
            else if (c == 4) {
                pairCount += 2;
            }

            if (c == 1 || c == 3) {
                //如果已经有单牌了，表示不止一张单牌，并没有下叫。直接闪
                if (danPai >= 0) {
                    break;
                }
                danPai = k;
            }
        }

        //检查是否有6对 并且单牌是不是目标牌
        if (pairCount == 6) {
            //七对只能和一张，就是手上那张单牌
            //七对的番数＝ 2番+N个4个牌（即龙七对）
            seatData.tingMap[danPai] = {
                fan: 2,
                pattern: "7pairs"
            };
            //如果是，则直接返回咯
        }
    }

    //检查是否是对对胡  由于四川麻将没有吃，所以只需要检查手上的牌
    //对对胡叫牌有两种情况
    //1、N坎 + 1张单牌
    //2、N-1坎 + 两对牌
    var singleCount = 0;
    var colCount = 0;
    var pairCount = 0;
    var arr = [];
    for (var k in seatData.countMap) {
        var c = seatData.countMap[k];
        if (c == 1) {
            singleCount++;
            arr.push(k);
        }
        else if (c == 2) {
            pairCount++;
            arr.push(k);
        }
        else if (c == 3) {
            colCount++;
        }
        else if (c == 4) {
            //手上有4个一样的牌，在四川麻将中是和不了对对胡的 随便加点东西
            singleCount++;
            pairCount += 2;
        }
    }

    if ((pairCount == 2 && singleCount == 0) || (pairCount == 0 && singleCount == 1)) {
        for (var i = 0; i < arr.length; ++i) {
            //对对胡1番
            var p = arr[i];
            if (seatData.tingMap[p] == null) {
                seatData.tingMap[p] = {
                    pattern: "duidui",
                    fan: 1
                };
            }
        }
    }

    //console.log(seatData.holds);
    //console.log(seatData.countMap);
    //console.log("singleCount:" + singleCount + ",colCount:" + colCount + ",pairCount:" + pairCount);
    //检查是不是平胡
    if (seatData.que != 0) {
        mjutils.checkTingPai(seatData, 0, 9);
    }

    if (seatData.que != 1) {
        mjutils.checkTingPai(seatData, 9, 18);
    }

    if (seatData.que != 2) {
        mjutils.checkTingPai(seatData, 18, 27);
    }
};
//检查是否可以碰
function checkCanPeng(game, seatData, targetPai) {
    if (getMJType(targetPai) == seatData.que) {
        return;
    }
    var count = seatData.countMap[targetPai];
    if (count != null && count >= 2) {
        seatData.canPeng = true;
    }
}

//检查是否可以点杠
function checkCanDianGang(game, seatData, targetPai) {
    //检查玩家手上的牌
    //如果没有牌了，则不能再杠
    if (game.mahjongs.length <= game.currentIndex) {
        return;
    }
    if (getMJType(targetPai) == seatData.que) {
        return;
    }
    var count = seatData.countMap[targetPai];
    if (count != null && count >= 3) {
        seatData.canGang = true;
        seatData.gangPai.push(targetPai);
        return;
    }
}

exports.chuPai = function (userId, pai) {
    pai = Number.parseInt(pai);
    var seatData = gameSeatsOfUsers[userId];
    if (seatData == null) {
        console.log("can't find user game data.");
        return;
    }

    var game = seatData.game;
    var seatIndex = seatData.seatIndex;
    //如果不该他出，则忽略
    if (game.turn != seatData.seatIndex) {
        console.log("not your turn.");
        return;
    }

    if (seatData.hued) {
        console.log('you have already hued. no kidding plz.');
        return;
    }

    if (seatData.canChuPai == false) {
        console.log('no need chupai.');
        return;
    }

    if (hasOperations(seatData)) {
        console.log('plz guo before you chupai.');
        return;
    }

    //从此人牌中扣除
    var index = seatData.holds.indexOf(pai);
    if (index == -1) {
        console.log("holds:" + seatData.holds);
        console.log("can't find mj." + pai);
        return;
    }

    seatData.canChuPai = false;
    game.chupaiCnt++;
    seatData.guoHuFan = -1;

    seatData.holds.splice(index, 1);
    seatData.countMap[pai]--;
    game.chuPai = pai;
    recordGameAction(game, seatData.seatIndex, ACTION_CHUPAI, pai);
    checkCanTingPai(game, seatData);

    userMgr.broacastInRoom('game_chupai_notify_push', { userId: seatData.userId, pai: pai }, seatData.userId, true);

    //如果出的牌可以胡，则算过胡
    if (seatData.tingMap[game.chuPai]) {
        seatData.guoHuFan = seatData.tingMap[game.chuPai].fan;
    }

    //检查是否有人要胡，要碰 要杠
    var hasActions = false;
    for (var i = 0; i < game.gameSeats.length; ++i) {
        //玩家自己不检查
        if (game.turn == i) {
            continue;
        }
        var ddd = game.gameSeats[i];
        //已经和牌的不再检查
        if (ddd.hued) {
            continue;
        }

        checkCanHu(game, ddd, pai);
        if (seatData.lastFangGangSeat == -1) {
            if (ddd.canHu && ddd.guoHuFan >= 0 && ddd.tingMap[pai].fan <= ddd.guoHuFan) {
                console.log("ddd.guoHuFan:" + ddd.guoHuFan);
                ddd.canHu = false;
                userMgr.sendMsg(ddd.userId, 'guohu_push');
            }
        }
        checkCanPeng(game, ddd, pai);
        checkCanDianGang(game, ddd, pai);
        if (hasOperations(ddd)) {
            sendOperations(game, ddd, game.chuPai);
            hasActions = true;
        }
    }

    //如果没有人有操作，则向下一家发牌，并通知他出牌
    if (!hasActions) {
        setTimeout(function () {
            userMgr.broacastInRoom('guo_notify_push', { userId: seatData.userId, pai: game.chuPai }, seatData.userId, true);
            seatData.folds.push(game.chuPai);
            game.chuPai = -1;
            moveToNextUser(game);
            doUserMoPai(game);
        }, 500);
    }
};
//检查是否可以弯杠(自己摸起来的时候)
function checkCanWanGang(game, seatData) {
    //如果没有牌了，则不能再杠
    if (game.mahjongs.length <= game.currentIndex) {
        return;
    }

    //从碰过的牌中选
    for (var i = 0; i < seatData.pengs.length; ++i) {
        var pai = seatData.pengs[i];
        if (seatData.countMap[pai] == 1) {
            seatData.canGang = true;
            seatData.gangPai.push(pai);
        }
    }
}
// 让玩家摸牌
function doUserMoPai(game) {
    game.chuPai = -1;
    var turnSeat = game.gameSeats[game.turn];
    turnSeat.lastFangGangSeat = -1;
    turnSeat.guoHuFan = -1;
    var pai = mopai(game, game.turn);
    //牌摸完了，结束
    if (pai == -1) {
        doGameOver(game, turnSeat.userId);
        return;
    }
    else {
        var numOfMJ = game.mahjongs.length - game.currentIndex;
        userMgr.broacastInRoom('mj_count_push', numOfMJ, turnSeat.userId, true);
    }

    recordGameAction(game, game.turn, ACTION_MOPAI, pai);

    //通知前端新摸的牌
    userMgr.sendMsg(turnSeat.userId, 'game_mopai_push', pai);
    //检查是否可以暗杠或者胡
    //检查胡，直杠，弯杠
    checkCanAnGang(game, turnSeat);
    checkCanWanGang(game, turnSeat, pai);

    //检查看是否可以和
    checkCanHu(game, turnSeat, pai);

    //广播通知玩家出牌方
    turnSeat.canChuPai = true;
    userMgr.broacastInRoom('game_chupai_push', turnSeat.userId, turnSeat.userId, true);

    //通知玩家做对应操作
    sendOperations(game, turnSeat, game.chuPai);
}
// 设置下一个玩家出牌
function moveToNextUser(game, nextSeat) {
    game.fangpaoshumu = 0;
    //找到下一个没有和牌的玩家
    if (nextSeat == null) {
        // 找到下一个玩家，如果玩家不能胡牌，就让该玩家操作
        while (true) {
            game.turn++;
            var playNum = game.conf.playerNum;
            game.turn %= playNum;
            var turnSeat = game.gameSeats[game.turn];
            if (turnSeat.hued == false) {
                return;
            }
        }
    } else {
        game.turn = nextSeat;
    }
}

function construct_game_base_info(game) {
    var baseInfo = {
        type: game.conf.type,
        button: game.button,
        index: game.gameIndex,
        mahjongs: game.mahjongs,
        game_seats: new Array(4)
    }
    var playerNum = game.roomInfo.conf.playerNum;
    for (var i = 0; i < playerNum; ++i) {
        baseInfo.game_seats[i] = game.gameSeats[i].holds;
    }
    game.baseInfoJson = JSON.stringify(baseInfo);
}
function getMJType(id) {
    if (id >= 0 && id < 9) {
        //筒
        return 0;
    }
    else if (id >= 9 && id < 18) {
        //条
        return 1;
    }
    else if (id >= 18 && id < 27) {
        //万
        return 2;
    }
}
function hasOperations(seatData) {
    if (seatData.canGang || seatData.canPeng || seatData.canHu) {
        return true;
    }
    return false;
}
function sendOperations(game, seatData, pai) {
    if (hasOperations(seatData)) {
        if (pai == -1) {
            pai = seatData.holds[seatData.holds.length - 1];
        }

        var data = {
            pai: pai,
            hu: seatData.canHu,
            peng: seatData.canPeng,
            gang: seatData.canGang,
            gangpai: seatData.gangPai
        };

        //如果可以有操作，则进行操作
        userMgr.sendMsg(seatData.userId, 'game_action_push', data);

        data.si = seatData.seatIndex;
    }
    else {
        userMgr.sendMsg(seatData.userId, 'game_action_push');
    }
}

function checkCanHu(game, seatData, targetPai) {
    game.lastHuPaiSeat = -1;
    if (getMJType(targetPai) == seatData.que) {
        return;
    }
    seatData.canHu = false;
    for (var k in seatData.tingMap) {
        if (targetPai == k) {
            seatData.canHu = true;
        }
    }
}
//检查是否可以暗杠
function checkCanAnGang(game, seatData) {
    //如果没有牌了，则不能再杠
    if (game.mahjongs.length <= game.currentIndex) {
        return;
    }

    for (var key in seatData.countMap) {
        var pai = parseInt(key);
        if (getMJType(pai) != seatData.que) {
            var c = seatData.countMap[key];
            if (c != null && c == 4) {
                seatData.canGang = true;
                seatData.gangPai.push(pai);
            }
        }
    }
}
//检查听牌
function checkCanTingPai(game, seatData) {
    seatData.tingMap = {};

    //检查手上的牌是不是已打缺，如果未打缺，则不进行判定
    for (var i = 0; i < seatData.holds.length; ++i) {
        var pai = seatData.holds[i];
        if (getMJType(pai) == seatData.que) {
            return;
        }
    }

    //检查是否是七对 前提是没有碰，也没有杠 ，即手上拥有13张牌
    if (seatData.holds.length == 13) {
        //有5对牌
        var hu = false;
        var danPai = -1;
        var pairCount = 0;
        for (var k in seatData.countMap) {
            var c = seatData.countMap[k];
            if (c == 2 || c == 3) {
                pairCount++;
            }
            else if (c == 4) {
                pairCount += 2;
            }

            if (c == 1 || c == 3) {
                //如果已经有单牌了，表示不止一张单牌，并没有下叫。直接闪
                if (danPai >= 0) {
                    break;
                }
                danPai = k;
            }
        }

        //检查是否有6对 并且单牌是不是目标牌
        if (pairCount == 6) {
            //七对只能和一张，就是手上那张单牌
            //七对的番数＝ 2番+N个4个牌（即龙七对）
            seatData.tingMap[danPai] = {
                fan: 2,
                pattern: "7pairs"
            };
            //如果是，则直接返回咯
        }
    }

    //检查是否是对对胡  由于四川麻将没有吃，所以只需要检查手上的牌
    //对对胡叫牌有两种情况
    //1、N坎 + 1张单牌
    //2、N-1坎 + 两对牌
    var singleCount = 0;
    var colCount = 0;
    var pairCount = 0;
    var arr = [];
    for (var k in seatData.countMap) {
        var c = seatData.countMap[k];
        if (c == 1) {
            singleCount++;
            arr.push(k);
        }
        else if (c == 2) {
            pairCount++;
            arr.push(k);
        }
        else if (c == 3) {
            colCount++;
        }
        else if (c == 4) {
            //手上有4个一样的牌，在四川麻将中是和不了对对胡的 随便加点东西
            singleCount++;
            pairCount += 2;
        }
    }

    if ((pairCount == 2 && singleCount == 0) || (pairCount == 0 && singleCount == 1)) {
        for (var i = 0; i < arr.length; ++i) {
            //对对胡1番
            var p = arr[i];
            if (seatData.tingMap[p] == null) {
                seatData.tingMap[p] = {
                    pattern: "duidui",
                    fan: 1
                };
            }
        }
    }

    //console.log(seatData.holds);
    //console.log(seatData.countMap);
    //console.log("singleCount:" + singleCount + ",colCount:" + colCount + ",pairCount:" + pairCount);
    //检查是不是平胡
    if (seatData.que != 0) {
        mjutils.checkTingPai(seatData, 0, 9);
    }

    if (seatData.que != 1) {
        mjutils.checkTingPai(seatData, 9, 18);
    }

    if (seatData.que != 2) {
        mjutils.checkTingPai(seatData, 18, 27);
    }
}
function calculateResult(game, roomInfo) {

    var isNeedChaDaJia = needChaDaJiao(game);
    if (isNeedChaDaJia) {
        chaJiao(game);
    }

    var baseScore = game.conf.baseScore;
    var numOfHued = 0;
    for (var i = 0; i < game.gameSeats.length; ++i) {
        if (game.gameSeats[i].hued == true) {
            numOfHued++;
        }
    }

    for (var i = 0; i < game.gameSeats.length; ++i) {
        var sd = game.gameSeats[i];

        //统计杠的数目
        sd.numAnGang = sd.angangs.length;
        sd.numMingGang = sd.wangangs.length + sd.diangangs.length;

        //对所有胡牌的玩家进行统计
        if (isTinged(sd)) {
            //统计自己的番子和分数
            //基础番(平胡0番，对对胡1番、七对2番) + 清一色2番 + 杠+1番
            //杠上花+1番，杠上炮+1番 抢杠胡+1番，金钩胡+1番，海底胡+1番
            var fan = sd.fan;
            if (isQingYiSe(sd)) {
                sd.qingyise = true;
                fan += 2;
            }

            var numOfGangs = sd.diangangs.length + sd.wangangs.length + sd.angangs.length;
            for (var j = 0; j < sd.pengs.length; ++j) {
                var pai = sd.pengs[j];
                if (sd.countMap[pai] == 1) {
                    numOfGangs++;
                }
            }
            for (var k in sd.countMap) {
                if (sd.countMap[k] == 4) {
                    numOfGangs++;
                }
            }
            sd.numofgen = numOfGangs;

            //金钩胡
            if (sd.holds.length == 1 || sd.holds.length == 2) {
                fan += 1;
                sd.isJinGouHu = true;
            }

            if (sd.isHaiDiHu) {
                fan += 1;
            }

            if (game.conf.tiandihu) {
                if (sd.isTianHu) {
                    fan += 3;
                }
                else if (sd.isDiHu) {
                    fan += 2;
                }
            }

            var isjiangdui = false;
            if (game.conf.jiangdui) {
                if (sd.pattern == "7pairs") {
                    if (sd.numofgen > 0) {
                        sd.numofgen -= 1;
                        sd.pattern == "l7pairs";
                        isjiangdui = isJiangDui(sd);
                        if (isjiangdui) {
                            sd.pattern == "j7paris";
                            fan += 2;
                        }
                        else {
                            fan += 1;
                        }
                    }
                }
                else if (sd.pattern == "duidui") {
                    isjiangdui = isJiangDui(sd);
                    if (isjiangdui) {
                        sd.pattern = "jiangdui";
                        fan += 2;
                    }
                }
            }

            if (game.conf.menqing) {
                //不是将对，才检查中张
                if (!isjiangdui) {
                    sd.isZhongZhang = isZhongZhang(sd);
                    if (sd.isZhongZhang) {
                        fan += 1;
                    }
                }

                sd.isMenQing = isMenQing(sd);
                if (sd.isMenQing) {
                    fan += 1;
                }
            }

            fan += sd.numofgen;
            if (sd.isGangHu) {
                fan += 1;
            }
            if (sd.isQiangGangHu) {
                fan += 1;
            }

            //收杠钱
            var additonalscore = 0;
            for (var a = 0; a < sd.actions.length; ++a) {
                var ac = sd.actions[a];
                if (ac.type == "fanggang") {
                    var ts = game.gameSeats[ac.targets[0]];
                    //检查放杠的情况，如果目标没有和牌，且没有叫牌，则不算 用于优化前端显示
                    if (isNeedChaDaJia && (ts.hued) == false && (isTinged(ts) == false)) {
                        ac.state = "nop";
                    }
                }
                else if (ac.type == "angang" || ac.type == "wangang" || ac.type == "diangang") {
                    if (ac.state != "nop") {
                        var acscore = ac.score;
                        additonalscore += ac.targets.length * acscore * baseScore;
                        //扣掉目标方的分
                        for (var t = 0; t < ac.targets.length; ++t) {
                            var six = ac.targets[t];
                            game.gameSeats[six].score -= acscore * baseScore;
                        }
                    }
                }
                else if (ac.type == "maozhuanyu") {
                    //对于呼叫转移，如果对方没有叫牌，表示不得行
                    if (isTinged(ac.owner)) {
                        //如果
                        var ref = ac.ref;
                        var acscore = ref.score;
                        var total = ref.targets.length * acscore * baseScore;
                        additonalscore += total;
                        //扣掉目标方的分
                        if (ref.payTimes == 0) {
                            for (var t = 0; t < ref.targets.length; ++t) {
                                var six = ref.targets[t];
                                game.gameSeats[six].score -= acscore * baseScore;
                            }
                        }
                        else {
                            //如果已经被扣过一次了，则由杠牌这家赔
                            ac.owner.score -= total;
                        }
                        ref.payTimes++;
                        ac.owner = null;
                        ac.ref = null;
                    }
                }
                else if (ac.type == "zimo" || ac.type == "hu" || ac.type == "ganghua" || ac.type == "dianganghua" || ac.type == "gangpaohu" || ac.type == "qiangganghu" || ac.type == "chadajiao") {
                    var extraScore = 0;
                    if (ac.iszimo) {
                        if (game.conf.zimo == 0) {
                            //自摸加底
                            extraScore = baseScore;
                        }
                        if (game.conf.zimo == 1) {
                            fan += 1;
                        }
                        else {
                            //nothing.
                        }
                        sd.numZiMo++;
                    }
                    else {
                        if (ac.type != "chadajiao") {
                            sd.numJiePao++;
                        }
                    }

                    var score = computeFanScore(game, fan) + extraScore;
                    sd.score += score * ac.targets.length;

                    for (var t = 0; t < ac.targets.length; ++t) {
                        var six = ac.targets[t];
                        var td = game.gameSeats[six];
                        td.score -= score;
                        if (td != sd) {
                            if (ac.type == "chadajiao") {
                                td.numChaJiao++;
                            }
                            else if (!ac.iszimo) {
                                td.numDianPao++;
                            }
                        }
                    }
                }
            }

            if (fan > game.conf.maxFan) {
                fan = game.conf.maxFan;
            }
            //一定要用 += 。 因为此时的sd.score可能是负的
            sd.score += additonalscore;
            if (sd.pattern != null) {
                sd.fan = fan;
            }
        }
        else {
            for (var a = sd.actions.length - 1; a >= 0; --a) {
                var ac = sd.actions[a];
                if (ac.type == "angang" || ac.type == "wangang" || ac.type == "diangang") {
                    //如果3家都胡牌，则需要结算。否则认为是查叫
                    if (numOfHued < 3) {
                        sd.actions.splice(a, 1);
                    }
                    else {
                        if (ac.state != "nop") {
                            var acscore = ac.score;
                            sd.score += ac.targets.length * acscore * baseScore;
                            //扣掉目标方的分
                            for (var t = 0; t < ac.targets.length; ++t) {
                                var six = ac.targets[t];
                                game.gameSeats[six].score -= acscore * baseScore;
                            }
                        }
                    }
                }
            }
        }
    }
}
function doGameOver(game, userId, forceEnd) {
    var roomId = roomMgr.getUserRoom(userId);
    if (roomId == null) {
        return;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return;
    }

    var results = [];
    var dbresult = [0, 0, 0, 0];

    var fnNoticeResult = function (isEnd) {
        var endinfo = null;
        if (isEnd) {
            endinfo = [];
            for (var i = 0; i < roomInfo.seats.length; ++i) {
                var rs = roomInfo.seats[i];
                endinfo.push({
                    numzimo: rs.numZiMo,
                    numjiepao: rs.numJiePao,
                    numdianpao: rs.numDianPao,
                    numangang: rs.numAnGang,
                    numminggang: rs.numMingGang,
                    numchadajiao: rs.numChaJiao,
                });
            }
        }
        userMgr.broacastInRoom('game_over_push', { results: results, endinfo: endinfo }, userId, true);
        //如果局数已够，则进行整体结算，并关闭房间
        if (isEnd) {
            setTimeout(function () {
                if (roomInfo.numOfGames > 1) {
                    store_history(roomInfo);
                }

                userMgr.kickAllInRoom(roomId);
                roomMgr.destroy(roomId);
                db.archive_games(roomInfo.uuid);
            }, 1500);
        }
    }

    if (game != null) {
        if (!forceEnd) {
            calculateResult(game, roomInfo);
        }

        for (var i = 0; i < roomInfo.seats.length; ++i) {
            var rs = roomInfo.seats[i];
            var sd = game.gameSeats[i];

            rs.ready = false;
            rs.score += sd.score;
            rs.numZiMo += sd.numZiMo;
            rs.numJiePao += sd.numJiePao;
            rs.numDianPao += sd.numDianPao;
            rs.numAnGang += sd.numAnGang;
            rs.numMingGang += sd.numMingGang;
            rs.numChaJiao += sd.numChaJiao;

            var userRT = {
                userId: sd.userId,
                pengs: sd.pengs,
                actions: [],
                wangangs: sd.wangangs,
                diangangs: sd.diangangs,
                angangs: sd.angangs,
                numofgen: sd.numofgen,
                holds: sd.holds,
                fan: sd.fan,
                score: sd.score,
                totalscore: rs.score,
                qingyise: sd.qingyise,
                pattern: sd.pattern,
                isganghu: sd.isGangHu,
                menqing: sd.isMenQing,
                zhongzhang: sd.isZhongZhang,
                jingouhu: sd.isJinGouHu,
                haidihu: sd.isHaiDiHu,
                tianhu: sd.isTianHu,
                dihu: sd.isDiHu,
                huorder: game.hupaiList.indexOf(i),
            };

            for (var k in sd.actions) {
                userRT.actions[k] = {
                    type: sd.actions[k].type,
                };
            }
            results.push(userRT);


            dbresult[i] = sd.score;
            delete gameSeatsOfUsers[sd.userId];
        }
        delete games[roomId];

        var old = roomInfo.nextButton;
        if (game.yipaoduoxiang >= 0) {
            roomInfo.nextButton = game.yipaoduoxiang;
        } else if (game.firstHupai >= 0) {
            roomInfo.nextButton = game.firstHupai;
        } else {
            roomInfo.nextButton = (game.turn + 1) % 4;
        }

        if (old != roomInfo.nextButton) {
            db.update_next_button(roomId, roomInfo.nextButton);
        }
    }

    if (forceEnd || game == null) {
        fnNoticeResult(true);
    } else {
        //保存游戏
        store_game(game, function (ret) {

            db.update_game_result(roomInfo.uuid, game.gameIndex, dbresult);

            //记录打牌信息
            var str = JSON.stringify(game.actionList);
            db.update_game_action_records(roomInfo.uuid, game.gameIndex, str);

            //保存游戏局数
            db.update_num_of_turns(roomId, roomInfo.numOfGames);

            //如果是第一次，并且不是强制解散 则扣除房卡
            if (roomInfo.numOfGames == 1) {
                var cost = 2;
                if (roomInfo.conf.maxGames == 8) {
                    cost = 3;
                }
                db.cost_gems(game.gameSeats[0].userId, cost);
            }

            var isEnd = (roomInfo.numOfGames >= roomInfo.conf.maxGames);
            fnNoticeResult(isEnd);
        });
    }
}

/**
 * 游戏房间解散系列操作 start
 */
var dissolvingList = [];
exports.doDissolve = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return null;
    }

    var game = games[roomId];
    doGameOver(game, roomInfo.seats[0].userId, true);
};

exports.dissolveRequest = function (roomId, userId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        console.log('请求解散失败，游戏找不到房间信息');
        return null;
    }

    if (roomInfo.dr != null) {
        console.log('请求解散失败，游戏找不到房间解散信息');
        return null;
    }

    var seatIndex = roomMgr.getUserSeat(userId);
    if (seatIndex == null) {
        console.log('请求解散失败，玩家不在座位上');
        return null;
    }

    // 最大支持4个玩家，当玩家数量不足四个的时候，空位置上默认时true
    var statesSet = [false, false, false, false];
    for (var i = 0; i < roomInfo.conf.playerNum; i++) {
        statesSet[statesSet.length - 1 - i] = true;
    }
    roomInfo.dr = {
        endTime: Date.now() + 10000,
        states: statesSet
    };
    roomInfo.dr.states[seatIndex] = true;

    dissolvingList.push(roomId);

    return roomInfo;
};

exports.dissolveAgree = function (roomId, userId, agree) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        console.log('同意解散失败，玩家不在座位上');
        return null;
    }

    if (roomInfo.dr == null) {
        console.log('同意解散失败，房间没有解散信息');
        return null;
    }

    var seatIndex = roomMgr.getUserSeat(userId);
    if (seatIndex == null) {
        console.log('同意解散失败，玩家不在座位上');
        return null;
    }

    if (agree) {
        roomInfo.dr.states[seatIndex] = true;
    }
    else {
        roomInfo.dr = null;
        var idx = dissolvingList.indexOf(roomId);
        if (idx != -1) {
            dissolvingList.splice(idx, 1);
        }
    }
    return roomInfo;
};



function update() {
    for (var i = dissolvingList.length - 1; i >= 0; --i) {
        var roomId = dissolvingList[i];

        var roomInfo = roomMgr.getRoom(roomId);
        if (roomInfo != null && roomInfo.dr != null) {
            if (Date.now() > roomInfo.dr.endTime) {
                console.log("delete room and games");
                exports.doDissolve(roomId);
                dissolvingList.splice(i, 1);
            }
        }
        else {
            dissolvingList.splice(i, 1);
        }
    }
}

setInterval(update, 1000);
/**
 * 游戏房间解散系列操作 end
 */