/**
 * 维护了所有房间信息，包括房间在哪房间配置，玩家座位及其所属房间
 */
var db = require('../utils/db');

var rooms = {};
var creatingRooms = {};

var userLocation = {};
var totalRooms = 0;

/**
 * 生成一个房间id
 */
function generateRoomId() {
    var roomId = "";
    for (var i = 0; i < 6; ++i) {
        roomId += Math.floor(Math.random() * 10);
    }
    return roomId;
}
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
        s.numZiMo = 0;
        s.numJiePao = 0;
        s.numDianPao = 0;
        s.numAnGang = 0;
        s.numMingGang = 0;
        s.numChaJiao = 0;

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
 * 返回玩家在房间内的座位号
 */
exports.getUserSeat = function (userId) {
    var location = userLocation[userId];
    //console.log(userLocation[userId]);
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
                        uuid: "",
                        id: roomId,
                        playerNum: 0,
                        createTime: createTime,
                        nextButton: 0,
                        numOfGames: 0,
                        seats: [],
                        conf: {
                            type: roomConf.type,
                            playerNum: roomConf.playerNum,
                            playRound: roomConf.playRound,
                            maxGames: roomConf.jushuxuanze,
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
                    var conf = roomInfo.conf;
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
 * 进入房间
 */
exports.enterRoom = function (roomId, userId, userName, callback) {
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
    if (room) {
        var ret = fnTakeSeat(room);
        callback(ret);
    }
    else {
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