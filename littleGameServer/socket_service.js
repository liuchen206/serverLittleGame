var crypto = require('../utils/crypto');
var db = require('../utils/db');

var tokenMgr = require('./tokenmgr');
var roomMgr = require('./roommgr');
var userMgr = require('./usermgr');
var io = null;
exports.start = function (config, mgr) {
    io = require('socket.io')(config.CLIENT_PORT);
    io.sockets.on('connection', function (socket) {
        /**
         * -------------------房间通用消息 start----------------------
         */
        //断开链接,即掉线
        socket.on('disconnect', function (data) {
            var userId = socket.userId;
            if (!userId) {
                return;
            }
            var data = {
                userid: userId,
                online: false
            };

            //通知房间内其它玩家
            userMgr.broacastInRoom('user_state_push', data, userId);

            //清除玩家的在线信息
            userMgr.del(userId);
            socket.userId = null;
        });
        //接收客户端的心跳
        socket.on('game_ping', function (data) {
            var userId = socket.userId;
            if (!userId) {
                return;
            }
            //console.log('game_ping');
            socket.emit('game_pong');
        });
        //接受客户端的登录，同时同步房间信息
        socket.on('login', function (data) {
            data = JSON.parse(data);
            if (socket.userId != null) {
                //已经登陆过的就忽略
                return;
            }
            var token = data.token;
            var roomId = data.roomid;
            var time = data.time;
            var sign = data.sign;

            console.log('login roomId', roomId);
            console.log('login roomId', token);
            console.log('login roomId', time);
            console.log('login roomId', sign);

            //检查参数合法性
            if (token == null || roomId == null || sign == null || time == null) {
                console.log(1);
                socket.emit('login_result', { errcode: 1, errmsg: "invalid parameters,on login" });
                return;
            }

            //检查参数是否被篡改
            var md5 = crypto.md5(roomId + token + time + config.ROOM_PRI_KEY);
            if (md5 != sign) {
                console.log(2);
                socket.emit('login_result', { errcode: 2, errmsg: "login failed. invalid sign!" });
                return;
            }

            //检查token是否有效
            if (tokenMgr.isTokenValid(token) == false) {
                console.log(3);
                socket.emit('login_result', { errcode: 3, errmsg: "token out of time." });
                return;
            }

            //检查房间合法性
            var userId = tokenMgr.getUserID(token);
            var roomId = roomMgr.getUserRoom(userId);

            userMgr.bind(userId, socket);
            socket.userId = userId;

            //返回房间信息
            var roomInfo = roomMgr.getRoom(roomId);

            var seatIndex = roomMgr.getUserSeat(userId);
            roomInfo.seats[seatIndex].ip = socket.handshake.address;

            var userData = null;
            var seats = [];
            for (var i = 0; i < roomInfo.seats.length; ++i) {
                var rs = roomInfo.seats[i];
                var online = false;
                if (rs.userId > 0) {
                    online = userMgr.isOnline(rs.userId);
                }

                seats.push({
                    userid: rs.userId,
                    ip: rs.ip,
                    score: rs.score,
                    name: rs.name,
                    online: online,
                    ready: rs.ready,
                    seatindex: i
                });

                if (userId == rs.userId) {
                    userData = seats[i];
                }
            }

            //通知前端
            var ret = {
                errcode: 0,
                errmsg: "ok",
                serverType: config.serverType,
                data: {
                    roomid: roomInfo.id,
                    conf: roomInfo.conf,
                    numofgames: roomInfo.numOfGames,
                    seats: seats
                }
            };
            socket.emit('login_result', ret);

            //通知其它客户端
            userMgr.broacastInRoom('new_user_comes_push', userData, userId);

            socket.gameMgr = roomInfo.gameMgr;

            //玩家上线，强制设置为TRUE
            socket.gameMgr.setReady(userId, null);

            socket.emit('login_finished', { serverType: config.serverType });

            console.log("成功进入littlegame游戏房间", roomId);

            if (roomInfo.dr != null) {
                var dr = roomInfo.dr;
                var ramaingTime = (dr.endTime - Date.now()) / 1000;
                var data = {
                    time: ramaingTime,
                    states: dr.states
                }
                userMgr.sendMsg(userId, 'dissolve_notice_push', data);
            }
        });
        //解散房间，在游戏未开始阶段，房主可以通过此消息立即解散房间，不需要其他玩家同意
        socket.on('dispress', function (data) {
            var userId = socket.userId;
            if (userId == null) {
                console.log('找不到玩家，无法解散');
                return;
            }

            var roomId = roomMgr.getUserRoom(userId);
            if (roomId == null) {
                console.log('找不到房间号，无法解散');
                return;
            }

            //如果游戏已经开始，则不可以
            if (socket.gameMgr.hasBegan(roomId)) {
                console.log('游戏已经开始，请使用 dissolve_request 请所有人投票解散房间');
                return;
            }

            //如果不是房主，则不能解散房间
            if (roomMgr.isCreator(roomId, userId) == false) {
                console.log('不是房主，无法解散');
                return;
            }

            userMgr.broacastInRoom('dispress_push', {}, userId, true);
            userMgr.kickAllInRoom(roomId);
            roomMgr.destroy(roomId);
            socket.disconnect();
        });
        //退出房间，游戏未开始时，非房主通过此消息退出房间
        socket.on('exit', function (data) {
            var userId = socket.userId;
            if (userId == null) {
                console.log('找不到玩家id，无法退出房间');
                return;
            }

            var roomId = roomMgr.getUserRoom(userId);
            if (roomId == null) {
                console.log('找不到房间id，无法退出房间');
                return;
            }

            //如果游戏已经开始，则不可以
            if (socket.gameMgr.hasBegan(roomId)) {
                console.log('游戏已经开始，请使用dissolve_request 请所有人投票解散房间，无法退出房间');
                return;
            }

            //如果是房主，则只能走解散房间
            if (roomMgr.isCreator(userId)) {
                console.log('不是房主，无法退出房间');
                return;
            }

            //通知其它玩家，有人退出了房间
            userMgr.broacastInRoom('exit_notify_push', userId, userId, false);

            roomMgr.exitRoom(userId);
            userMgr.del(userId);

            socket.emit('exit_result');
            socket.disconnect();
        });
        //游戏中 解散房间
        socket.on('dissolve_request', function (data) {
            var userId = socket.userId;
            if (userId == null) {
                console.log('找不到玩家id，无法在游戏中解散房间');
                return;
            }

            var roomId = roomMgr.getUserRoom(userId);
            if (roomId == null) {
                console.log('找不到房间id，无法在游戏中解散房间');
                return;
            }

            //如果游戏未开始，则不可以
            if (socket.gameMgr.hasBegan(roomId) == false) {
                console.log('游戏没有开始，请使用 dispress 解散房间');
                return;
            }

            var ret = socket.gameMgr.dissolveRequest(roomId, userId);
            if (ret != null) {
                var dr = ret.dr;
                var ramaingTime = (dr.endTime - Date.now()) / 1000;
                var data = {
                    time: ramaingTime,
                    states: dr.states
                }
                console.log('广播 解散房间');
                userMgr.broacastInRoom('dissolve_notice_push', data, userId, true);
            } else {
                console.log('房间解散，游戏返回结果失败');
            }
        });
        // 同意 游戏中解散房间
        socket.on('dissolve_agree', function (data) {
            var userId = socket.userId;

            if (userId == null) {
                return;
            }

            var roomId = roomMgr.getUserRoom(userId);
            if (roomId == null) {
                return;
            }

            var ret = socket.gameMgr.dissolveAgree(roomId, userId, true);
            if (ret != null) {
                var dr = ret.dr;
                var ramaingTime = (dr.endTime - Date.now()) / 1000;
                var data = {
                    time: ramaingTime,
                    states: dr.states
                }
                userMgr.broacastInRoom('dissolve_notice_push', data, userId, true);

                var doAllAgree = true;
                for (var i = 0; i < dr.states.length; ++i) {
                    if (dr.states[i] == false) {
                        doAllAgree = false;
                        break;
                    }
                }

                if (doAllAgree) {
                    socket.gameMgr.doDissolve(roomId);
                }
            }
        });
        // 拒绝 游戏中解散房间
        socket.on('dissolve_reject', function (data) {
            var userId = socket.userId;

            if (userId == null) {
                return;
            }

            var roomId = roomMgr.getUserRoom(userId);
            if (roomId == null) {
                return;
            }

            var ret = socket.gameMgr.dissolveAgree(roomId, userId, false);
            if (ret != null) {
                userMgr.broacastInRoom('dissolve_cancel_push', {}, userId, true);
            }
        });
        /**
         * -------------------房间通用消息 end----------------------
         */

        /**
         * -------------------游戏逻辑消息 start----------------------
         */
        /**
         * -------------------游戏逻辑消息 end----------------------
         */
    });
};