var crypto = require('../utils/crypto');
var express = require('express');
var db = require('../utils/db');
var http = require('../utils/http');
var app = express();


var hallIp = null;
var config = null;
var rooms = {};
var serverMap = {};
var roomIdOfUsers = {};

exports.start = function ($config) {
    config = $config;
    app.listen(config.ROOM_PORT, config.FOR_ROOM_IP);
    console.log("room service is listening on " + config.FOR_ROOM_IP + ":" + config.ROOM_PORT);
};


//设置跨域访问
app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header("X-Powered-By", ' 3.2.1');
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
});

/**
 * 接受来自游戏服的同步请求
 */
app.get('/register_gs', function (req, res) {
    var ip = req.ip;
    var clientip = req.query.clientip;
    var clientport = req.query.clientport;
    var httpPort = req.query.httpPort;
    var load = req.query.load;
    var id = clientip + ":" + clientport;
    var serverType = req.query.serverType;
    if (serverMap[id]) {
        var info = serverMap[id];
        if (info.clientport != clientport || info.httpPort != httpPort || info.ip != ip) {
            console.log("register_gs 失败 duplicate gsid:" + id + ",addr:" + ip + "(" + httpPort + ")" + "游戏的类型：" + serverType);
            http.send(res, 1, "duplicate gsid:" + id);
            return;
        }
        info.load = load;
        http.send(res, 0, "ok", { ip: ip });
        return;
    }
    serverMap[id] = {
        ip: ip,
        id: id,
        clientip: clientip,
        clientport: clientport,
        httpPort: httpPort,
        load: load,
        serverType: serverType
    };
    http.send(res, 0, "ok", { ip: ip });
    console.log("game server registered.\n\tid:" + id + "\n\taddr:" + ip + "\n\thttp port:" + httpPort + "\n\tsocket clientport:" + clientport + " 游戏的类型：" + serverType);

    var reqdata = {
        serverid: id,
        sign: crypto.md5(id + config.ROOM_PRI_KEY),
        serverType: serverType,
    };
    //获取服务器信息
    http.get(ip, httpPort, "/get_server_info", reqdata, function (ret, data) {
        if (ret && data.errcode == 0) {
            for (var i = 0; i < data.userroominfo.length; i += 2) {
                var userId = data.userroominfo[i];
                var roomId = data.userroominfo[i + 1];
            }
        }
        else {
            console.log(data.errmsg);
        }
    });
});

function chooseServer(serverType) {
    console.log("查找类型为", serverType, "的游戏服");
    var serverinfo = null;
    for (var s in serverMap) {
        var info = serverMap[s];
        if (serverinfo == null) {
            if (serverType == info.serverType) {
                serverinfo = info;
            }
        }
        else {
            if (serverType == info.serverType) {
                if (serverinfo.load > info.load) {
                    serverinfo = info;
                }
            }
        }
    }
    if (serverType) console.log("返回类型为", serverinfo.serverType, serverinfo.clientport, "的游戏服");
    return serverinfo;
}

exports.createRoom = function (account, userId, roomConf, fnCallback) {
    var serverinfo = chooseServer(JSON.parse(roomConf).serverType);
    if (serverinfo == null) {
        fnCallback(101, null);
        return;
    }

    db.get_gems(account, function (data) {
        if (data != null) {
            //2、请求创建房间
            var reqdata = {
                userid: userId,
                gems: data.gems,
                conf: roomConf
            };
            reqdata.sign = crypto.md5(userId + roomConf + data.gems + config.ROOM_PRI_KEY);
            console.log("钻石验证.", serverinfo.ip, serverinfo.httpPort, JSON.stringify(reqdata));
            http.get(serverinfo.ip, serverinfo.httpPort, "/create_room", reqdata, function (ret, data) {
                console.log("create_room return ", data, ret);
                if (ret) {
                    if (data.errcode == 0) {
                        fnCallback(0, data.roomid);
                    }
                    else {
                        fnCallback(data.errcode, null);
                    }
                    return;
                }
                fnCallback(102, null);
            });
        }
        else {
            fnCallback(103, null);
        }
    });
};

exports.enterRoom = function (userId, name, roomId, fnCallback) {
    var reqdata = {
        userid: userId,
        name: name,
        roomid: roomId
    };
    reqdata.sign = crypto.md5(userId + name + roomId + config.ROOM_PRI_KEY);

    var checkRoomIsRuning = function (serverinfo, roomId, callback) {
        var sign = crypto.md5(roomId + config.ROOM_PRI_KEY);
        http.get(serverinfo.ip, serverinfo.httpPort, "/is_room_runing", { roomid: roomId, sign: sign }, function (ret, data) {
            if (ret) {
                if (data.errcode == 0 && data.runing == true) {
                    callback(true);
                }
                else {
                    callback(false);
                }
            }
            else {
                callback(false);
            }
        });
    }

    var enterRoomReq = function (serverinfo) {
        http.get(serverinfo.ip, serverinfo.httpPort, "/enter_room", reqdata, function (ret, data) {
            console.log("enter_room 返回", data);
            if (ret) {
                if (data.errcode == 0) {
                    db.set_room_id_of_user(userId, roomId, function (ret) {
                        fnCallback(0, {
                            ip: serverinfo.clientip,
                            port: serverinfo.clientport,
                            token: data.token
                        });
                    });
                }
                else {
                    console.log(data.errmsg);
                    fnCallback(data.errcode, null);
                }
            }
            else {
                fnCallback(-1, null);
            }
        });
    };

    var chooseServerAndEnter = function (serverinfo) {
        console.log("chooseServerAndEnter 选中的服务器", JSON.stringify(serverinfo));
        serverinfo = chooseServer(serverinfo.serverType);
        if (serverinfo != null) {
            enterRoomReq(serverinfo);
        }
        else {
            fnCallback(-1, null);
        }
    }

    db.get_room_addr(roomId, function (ret, ip, port) {
        if (ret) {
            var id = ip + ":" + port;
            var serverinfo = serverMap[id];
            if (ip = '127.0.0.1' && !serverinfo) { // 当使用本地服务器是，注册时使用的 ‘localhost’ 但是创建房间时痛的ip地址段。也就是这里数据库返回的ip字段； 当使用外网时注册和写入数据库的都是ip
                serverinfo = serverMap['localhost' + ":" + port];
            }
            console.log('尝试进入房间', id, serverinfo);
            if (serverinfo != null) {
                checkRoomIsRuning(serverinfo, roomId, function (isRuning) {
                    if (isRuning) {
                        console.log("请求进入");
                        enterRoomReq(serverinfo);
                    }
                    else {
                        console.log("选择服务器并且请求进入");
                        chooseServerAndEnter(serverinfo);
                    }
                });
            }
            else {
                console.log("serverinfo == null时，选择服务器并且请求进入");
                chooseServerAndEnter(serverinfo);
            }
        }
        else {
            fnCallback(-2, null);
        }
    });
};

