var roomMgr = require("./roommgr");
var userMgr = require("./usermgr");
var db = require("../utils/db");
var crypto = require("../utils/crypto");
var games = {}; //所有的桌上信息-键值为房间号
var gamesIdBase = 0;

var gameSeatsOfUsers = {}; // 玩家的个人状态-键值为玩家id

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
    console.log("littleGame setReady  roomId ", roomId);
    if (roomId == null) {
        return;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    console.log("littleGame setReady roomInfo", roomInfo)
    if (roomInfo == null) {
        return;
    }
    roomMgr.setReady(userId, true);

    var game = games[roomId]; // 获得这个房间的这一局的游戏情况
    console.log("littleGame setReady game", game);
    if (game == null) { // 这局没有开始，检查是不是所有人准备且人数达到。
        if (roomInfo.seats.length == 4) { // 4人是一局最大参与人数
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
                console.log("littleGame begin");
                exports.begin(roomId);
            } else {
                console.log('人数不满足开始游戏的条件');
            }
        }
    } else { // 对局已经开始
        console.log("对局已经开始，本局应有人数 ", roomInfo.conf.playerNum);

        var data = {
            state: game.state,
            turn: game.turn,
            serverType: 'littlGame',
        };

        data.seats = [];
        for (var i = 0; i < roomInfo.conf.playerNum; ++i) {
            var sd = game.gameSeats[i];
            if (!sd) {
                console.log('没有找到座位数据，index now =', i, game.gameSeats);
                return;
            }
            var s = {
                userid: sd.userId,
            }
            s.positonInMap = sd.positonInMap;
            data.seats.push(s);
        }

        //同步整个信息给客户端
        userMgr.sendMsg(userId, 'game_sync_push', data);
    }
};
//开始新的一局
exports.begin = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return;
    }
    var seats = roomInfo.seats;

    var game = {
        conf: roomInfo.conf,
        roomInfo: roomInfo,
        gameIndex: roomInfo.numOfGames,

        button: roomInfo.nextButton, // button == 庄家
        gameSeats: new Array(4),

        turn: 0,
        state: "idle",
    };

    roomInfo.numOfGames++;

    console.log('开始新的一局', roomInfo.conf.playerNum);
    for (var i = 0; i < roomInfo.conf.playerNum; i++) {
        var data = game.gameSeats[i] = {};

        data.game = game;

        data.seatIndex = i;

        data.userId = seats[i].userId;

        data.positonInMap = 0;

        gameSeatsOfUsers[data.userId] = data;
    }

    games[roomId] = game;

    //初始完毕后，通知前端必要的数据
    var lastPalyerInTable = null;
    for (var i = 0; i < roomInfo.conf.playerNum; ++i) {
        var s = seats[i];
        //通知玩家初始位置
        console.log('game.gameSeats', game.gameSeats[i], '\n', game.gameSeats[i].positonInMap);
        userMgr.sendMsg(s.userId, 'game_myPosition_push', game.gameSeats[i].positonInMap);
        //通知开始的是第几局
        userMgr.sendMsg(s.userId, 'game_num_push', roomInfo.numOfGames);
        //通知本局开始
        userMgr.sendMsg(s.userId, 'game_begin_push', { turn: game.button, serverType: 'littlGame' });

        lastPalyerInTable = game.gameSeats[i].userId;
    }

    // 此游戏没有前置设置，直接通知开始游戏
    userMgr.broacastInRoom('game_playing_push', null, lastPalyerInTable, true);
};

// 房间结束结算
function doGameOver(game, userId, forceEnd) {
    var roomId = roomMgr.getUserRoom(userId);
    if (roomId == null) {
        console.log('结束游戏失败，没有找到房间');
        return;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        console.log('结束游戏失败，没有找到房间信息');
        return;
    }
    console.log('执行关闭房间');
    userMgr.broacastInRoom('game_over_push', { justShut: 'hehehe' }, userId, true);
    userMgr.kickAllInRoom(roomId);
    roomMgr.destroy(roomId);
    delete games[roomId];
}

// 游戏中解散房间处理，即投票解散房间逻辑
var dissolvingList = [];
exports.doDissolve = function (roomId) {
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        console.log('执行解散房间失败，没有找到房间');
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
    } else {
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
        } else {
            dissolvingList.splice(i, 1);
        }
    }
}

setInterval(update, 1000);
