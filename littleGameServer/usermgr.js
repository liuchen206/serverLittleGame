/**
 * 维护了所有连接socket的玩家实例
 */
var roomMgr = require('./roommgr');
var userList = {};
var userOnline = 0;
/**
 * 将一个上线的玩家注册，以便管理
 */
exports.bind = function (userId, socket) {
    userList[userId] = socket;
    userOnline++;
};
/**
 * 将一个玩家移除管理
 */
exports.del = function (userId, socket) {
    delete userList[userId];
    userOnline--;
};
/**
 * 获得一个玩家的连接
 */
exports.get = function (userId) {
    return userList[userId];
};
/**
 * 检测玩家是否在线
 */
exports.isOnline = function (userId) {
    var data = userList[userId];
    if (data != null) {
        return true;
    }
    return false;
};
/**
 * 返回连接数
 */
exports.getOnlineCount = function () {
    return userOnline;
}
/**
 * 向某个玩家发送消息
 */
exports.sendMsg = function (userId, event, msgdata) {
    console.log(event);
    var userInfo = userList[userId];
    if (userInfo == null) {
        return;
    }
    var socket = userInfo;
    if (socket == null) {
        return;
    }

    socket.emit(event, msgdata);
};
/**
 * 关闭房间内的所有玩家连接
 */
exports.kickAllInRoom = function (roomId) {
    if (roomId == null) {
        return;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return;
    }

    for (var i = 0; i < roomInfo.seats.length; ++i) {
        var rs = roomInfo.seats[i];

        //如果不需要发给发送方，则跳过
        if (rs.userId > 0) {
            var socket = userList[rs.userId];
            if (socket != null) {
                exports.del(rs.userId);
                socket.disconnect();
            }
        }
    }
};
/**
 * 向发送者所在房间内的所有人广播
 */
exports.broacastInRoom = function (event, data, sender, includingSender) {
    var roomId = roomMgr.getUserRoom(sender);
    if (roomId == null) {
        return;
    }
    var roomInfo = roomMgr.getRoom(roomId);
    if (roomInfo == null) {
        return;
    }

    for (var i = 0; i < roomInfo.seats.length; ++i) {
        var rs = roomInfo.seats[i];
        //如果不需要发给发送方，则跳过
        if (rs.userId == sender && includingSender != true) {
            continue;
        }
        var socket = userList[rs.userId];
        if (socket != null) {
            socket.emit(event, data);
        }
    }
};