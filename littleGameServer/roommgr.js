/**
 * 维护了所有房间信息，包括房间在哪房间配置，玩家座位及其所属房间
 */
var db = require('../utils/db');

var rooms = {}; // 保存了每个房间的配置信息，座位玩家信息
var creatingRooms = {};

var userLocation = {}; // 保存了每个玩家的房间号和座位信息
var totalRooms = 0;

/**
 * 生成一个房间id
 */
function generateRoomId() {
    var roomId = "";
    var luckyNum = Math.floor(Math.random() * 10);
    var luckyNum2 = Math.floor(Math.random() * 10);
    var luckyNum3 = Math.floor(Math.random() * 10);

    var rangArray = [1, 2, 3];
    var luckyRang = rangArray[Math.floor(Math.random() * 100) % 3];
    for (var i = 0; i < 6; ++i) {
        if (luckyRang == 1) { //6个数字中总共有1个数字
            roomId += luckyNum;
        }
        if (luckyRang == 2) { //6个数字中总共有2个数字
            if (i < 3) {
                roomId += luckyNum;
            } else {
                roomId += luckyNum2;
            }
        }
        if (luckyRang == 3) { //6个数字中总共有2个数字
            if (i < 2) {
                roomId += luckyNum;
            } else if (i >= 2 && i < 4) {
                roomId += luckyNum2;
            }else{
                roomId += luckyNum3;
            }
        }
    }
    console.log('房间号生成', roomId);
    return roomId;
}
/**
 * 返回玩家在房间内的座位号
 */
exports.getUserSeat = function (userId) {
    var location = userLocation[userId];
    if (location != null) {
        return location.seatIndex;
    }
    return null;
};
/**
 * 返回房间总数
 */
exports.getTotalRooms = function () {
    return totalRooms;
}
exports.getUserLocations = function () {
    return userLocation;
};
exports.createRoom = function (creator, roomConf, gems, ip, port, callback) {
    if (roomConf.type == null
        || roomConf.playerNum == null
        || roomConf.playRound == null) {
        callback(1, null);
        console.log("err：房间信息不完整");
        return;
    }

    if (roomConf.playerNum < 2) {
        callback(1, null);
        console.log("err：玩家数量不合法");
        return;
    }

    if (roomConf.playRound < 1) {
        callback(1, null);
        console.log("err：游戏局数不合法");
        return;
    }
    var fnCreate = function () {
        var roomId = generateRoomId();
        if (rooms[roomId] != null || creatingRooms[roomId] != null) {
            fnCreate();
        }
        else {
            creatingRooms[roomId] = true; // 房间号正在被占用
            db.is_room_exist(roomId, function (ret) {
                if (ret) {
                    delete creatingRooms[roomId];
                    fnCreate();
                }
                else {
                    var createTime = Math.ceil(Date.now() / 1000);
                    var roomInfo = {
                        uuid: "", // 数据库id
                        id: roomId, // 房间id
                        createTime: createTime,//创建时间
                        nextButton: 0,
                        numOfGames: 0, // 进行到第几局
                        seats: [],
                        conf: {
                            type: roomConf.type,
                            playerNum: roomConf.playerNum, // 开始游戏的玩家数量
                            playRound: roomConf.playRound, // 总共玩几盘
                            creator: creator,
                        }
                    };

                    // 选择游戏管理器，表明游戏玩法
                    if (roomConf.type == "little_first") {
                        roomInfo.gameMgr = require("./gamemgr_first");
                    }
                    else {
                        roomInfo.gameMgr = require("./gamemgr_first");
                    }
                    console.log(roomInfo.conf);
                    // 初始化房间座位
                    for (var i = 0; i < 4; ++i) {
                        roomInfo.seats.push({
                            userId: 0,
                            score: 0,
                            name: "",
                            ready: false,
                            seatIndex: i,
                        });
                    }

                    //写入数据库
                    db.create_room(roomInfo.id, roomInfo.conf, ip, port, createTime, function (uuid) {
                        delete creatingRooms[roomId]; // 解除占用
                        if (uuid != null) {
                            roomInfo.uuid = uuid;
                            console.log(uuid);
                            rooms[roomId] = roomInfo; // 将房间放入管理数组，以备选择
                            totalRooms++;
                            callback(0, roomId);
                        }
                        else {
                            callback(3, null);
                        }
                    });
                }
            });
        }
    }

    fnCreate(); // 执行直至有了结果
};
/**
 * 使用数据库的房间信息构建房间
 * @param {数据库中的房间信息} dbdata 
 */
function constructRoomFromDb(dbdata) {
    var roomInfo = {
        uuid: dbdata.uuid,
        id: dbdata.id,
        numOfGames: dbdata.num_of_turns,
        createTime: dbdata.create_time,
        nextButton: dbdata.next_button,
        seats: new Array(4),
        conf: JSON.parse(dbdata.base_info)
    };


    if (roomInfo.conf.type == "little_first") {
        roomInfo.gameMgr = require("./gamemgr_first");
    }
    else {
        roomInfo.gameMgr = require("./gamemgr_first");
    }
    var roomId = roomInfo.id;

    for (var i = 0; i < 4; ++i) {
        var s = roomInfo.seats[i] = {};
        s.userId = dbdata["user_id" + i];
        s.score = dbdata["user_score" + i];
        s.name = dbdata["user_name" + i];
        s.ready = false;
        s.seatIndex = i;

        if (s.userId > 0) {
            userLocation[s.userId] = {
                roomId: roomId,
                seatIndex: i
            };
        }
    }
    rooms[roomId] = roomInfo;
    totalRooms++;
    return roomInfo;
}
/**
 * 进入房间
 */
exports.enterRoom = function (roomId, userId, userName, callback) {
    // 安排座位
    var fnTakeSeat = function (room) {
        if (exports.getUserRoom(userId) == roomId) {
            //已存在
            return 0;
        }
        // 按从小到大的次序给一个位置坐下
        for (var i = 0; i < 4; ++i) {
            var seat = room.seats[i];
            if (seat.userId <= 0) {
                seat.userId = userId;
                seat.name = userName;
                userLocation[userId] = {
                    roomId: roomId,
                    seatIndex: i
                };
                //console.log(userLocation[userId]);
                db.update_seat_info(roomId, i, seat.userId, "", seat.name);
                //正常
                return 0;
            }
        }
        //房间已满
        return 1;
    }
    // 找一个房间让玩家坐下
    var room = rooms[roomId];
    if (room) { // 在运行内存里找
        var ret = fnTakeSeat(room);
        callback(ret);
    }
    else { // 内存里找不到在数据库里找
        db.get_room_data(roomId, function (dbdata) {
            if (dbdata == null) {
                //找不到房间
                callback(2);
            }
            else {
                //construct room.
                room = constructRoomFromDb(dbdata);
                //
                var ret = fnTakeSeat(room);
                callback(ret);
            }
        });
    }
};
/**
 * 返回房间信息
 */
exports.getRoom = function (roomId) {
    return rooms[roomId];
};

/**
 * 返回坐下的玩家的房间号
 */
exports.getUserRoom = function (userId) {
    var location = userLocation[userId];
    if (location != null) {
        return location.roomId;
    }
    return null;
};
/**
 * 玩家是不是房间的房主
 */
exports.isCreator = function (roomId, userId) {
    var roomInfo = rooms[roomId];
    if (roomInfo == null) {
        return false;
    }
    return roomInfo.conf.creator == userId;
};
/**
 * 销毁房间，包括房间信息rooms，座位信息userLocation，数据库房间号数据和单个玩家房间号信息
 */
exports.destroy = function (roomId) {
    var roomInfo = rooms[roomId];
    if (roomInfo == null) {
        return;
    }

    for (var i = 0; i < 4; ++i) {
        var userId = roomInfo.seats[i].userId;
        if (userId > 0) {
            delete userLocation[userId];
            db.set_room_id_of_user(userId, null);
        }
    }

    delete rooms[roomId];
    totalRooms--;
    db.delete_room(roomId);
};
/**
 * 单个玩家退出房间
 */
exports.exitRoom = function (userId) {
    var location = userLocation[userId];
    if (location == null)
        return;

    var roomId = location.roomId;
    var seatIndex = location.seatIndex;
    var room = rooms[roomId];
    delete userLocation[userId];
    if (room == null || seatIndex == null) {
        return;
    }

    var seat = room.seats[seatIndex];
    seat.userId = 0;
    seat.name = "";

    var numOfPlayers = 0;
    for (var i = 0; i < room.seats.length; ++i) {
        if (room.seats[i].userId > 0) {
            numOfPlayers++;
        }
    }

    db.set_room_id_of_user(userId, null);

    if (numOfPlayers == 0) {
        exports.destroy(roomId);
    }
};
/**
 * 玩家准备
 */
exports.setReady = function (userId, value) {
    var roomId = exports.getUserRoom(userId); // 找到房间号
    if (roomId == null) {
        return;
    }

    var room = exports.getRoom(roomId); // 找到房间
    if (room == null) {
        return;
    }

    var seatIndex = exports.getUserSeat(userId); //找到座位号
    if (seatIndex == null) {
        return;
    }

    var s = room.seats[seatIndex]; // 设置已经准备
    s.ready = value;
}