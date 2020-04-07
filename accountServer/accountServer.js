var express = require('express');
var crypto = require('../utils/crypto');

var app = express();
var hallAddr = "";
var config = null;

//设置跨域访问
app.all('*', function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
    res.header("X-Powered-By", ' 3.2.1');
    res.header("Content-Type", "application/json;charset=utf-8");
    next();
});

function send(res, ret) {
    var str = JSON.stringify(ret);
    res.send(str);
}

exports.start = function (cfg) {
    config = cfg;
    hallAddr = config.HALL_IP + ":" + config.HALL_CLIENT_PORT;
    app.listen(config.CLIENT_PORT);
    console.log("account server is listening on " + config.CLIENT_PORT);
}
/**
 * 客户端loading时，请求的大厅地址，及其版本号做为是否更新的依据
 */
app.get('/get_serverinfo', function (req, res) {
    var ret = {
        version: config.VERSION,
        hall: hallAddr,
        appweb: config.APP_WEB,
    }
    send(res, ret);
});

/**
 * 游客登录请求查询账号签名
 */
app.get('/guest', function (req, res) {
    var account = "guest_" + req.query.account;
    var sign = crypto.md5(account + req.ip + config.ACCOUNT_PRI_KEY);
    var ret = {
        errcode: 0,
        errmsg: "ok",
        account: account,
        halladdr: hallAddr,
        sign: sign
    };
    send(res, ret);
});