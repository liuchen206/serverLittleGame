var db = require('../utils/db');

var rooms = {};
var creatingRooms = {};

var userLocation = {};
var totalRooms = 0;

var DI_FEN = [1, 2, 5];
var MAX_FAN = [3, 4, 5];
var JU_SHU = [4, 8];
var JU_SHU_COST = [2, 3];
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
/**
 * 返回所有玩家的房间座位信息
 */
exports.getUserLocations = function () {
    return userLocation;
};
exports.createRoom = function (creator, roomConf, gems, ip, port, callback) {
    if (roomConf.type == null
        || roomConf.difen == null
        || roomConf.zimo == null
        || roomConf.jiangdui == null
        || roomConf.huansanzhang == null
        || roomConf.zuidafanshu == null
        || roomConf.jushuxuanze == null
        || roomConf.dianganghua == null
        || roomConf.menqing == null
        || roomConf.tiandihu == null
        || roomConf.playerNum == null) {
        callback(1, null);
        return;
    }

    if (roomConf.difen < 0 || roomConf.difen > DI_FEN.length) {
        callback(1, null);
        return;
    }

    if (roomConf.zimo < 0 || roomConf.zimo > 2) {
        callback(1, null);
        return;
    }

    if (roomConf.zuidafanshu < 0 || roomConf.zuidafanshu > MAX_FAN.length) {
        callback(1, null);
        return;
    }

    if (roomConf.jushuxuanze < 0 || roomConf.jushuxuanze > JU_SHU.length) {
        callback(1, null);
        return;
    }

    var cost = JU_SHU_COST[roomConf.jushuxuanze];
    if (cost > gems) {
        callback(2222, null);
        return;
    }

    var fnCreate = function () {
        var roomId = generateRoomId();
        if (rooms[roomId] != null || creatingRooms[roomId] != null) {
            fnCreate();
        }
        else {
            creatingRooms[roomId] = true;
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
                        numOfGames: 0,
                        createTime: createTime,
                        nextButton: 0,
                        seats: [],
                        conf: {
                            type: roomConf.type,
                            baseScore: DI_FEN[roomConf.difen],
                            zimo: roomConf.zimo,
                            jiangdui: roomConf.jiangdui,
                            hsz: roomConf.huansanzhang,
                            dianganghua: parseInt(roomConf.dianganghua),
                            menqing: roomConf.menqing,
                            tiandihu: roomConf.tiandihu,
                            maxFan: MAX_FAN[roomConf.zuidafanshu],
                            maxGames: JU_SHU[roomConf.jushuxuanze],
                            creator: creator,
                            playerNum: roomConf.playerNum, // 开始游戏的玩家数量
                        }
                    };

                    if (roomConf.type == "xlch") {
                        roomInfo.gameMgr = require("./gamemgr_xlch");
                    } else {
                        roomInfo.gameMgr = require("./gamemgr_xzdd");
                    }
                    console.log(roomInfo.conf);

                    for (var i = 0; i < 4; ++i) {
                        roomInfo.seats.push({
                            userId: 0,
                            score: 0,
                            name: "",
                            ready: false,
                            seatIndex: i,
                            numZiMo: 0,
                            numJiePao: 0,
                            numDianPao: 0,
                            numAnGang: 0,
                            numMingGang: 0,
                            numChaJiao: 0,
                        });
                    }


                    //写入数据库
                    db.create_room(roomInfo.id, roomInfo.conf, ip, port, createTime, function (uuid) {
                        delete creatingRooms[roomId];
                        if (uuid != null) {
                            roomInfo.uuid = uuid;
                            console.log('存储房间信息放回. uuid ==', uuid);
                            rooms[roomId] = roomInfo;
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

    fnCreate();
};
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


    if (roomInfo.conf.type == "xlch") {
        roomInfo.gameMgr = require("./gamemgr_xlch");
    }
    else {
        roomInfo.gameMgr = require("./gamemgr_xzdd");
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
exports.enterRoom = function (roomId, userId, userName, callback) {
    var fnTakeSeat = function (room) {
        if (exports.getUserRoom(userId) == roomId) {
            //已存在
            return 0;
        }

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
    var room = rooms[roomId];
    if (room) {
        var ret = fnTakeSeat(room);
        callback(ret);
    } else {
        db.get_room_data(roomId, function (dbdata) {
            if (dbdata == null) {
                //找不到房间
                callback(2);
            }
            else {
                //construct room.
                console.log('内存中没有房间信息，数据库中创建房间', dbdata);
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
    var roomId = exports.getUserRoom(userId);
    if (roomId == null) {
        return;
    }

    var room = exports.getRoom(roomId);
    if (room == null) {
        return;
    }

    var seatIndex = exports.getUserSeat(userId);
    if (seatIndex == null) {
        return;
    }

    var s = room.seats[seatIndex];
    s.ready = value;
}