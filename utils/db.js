var mysql = require("mysql");
var crypto = require('./crypto');
var pool = null;

exports.init = function (config) {
    pool = mysql.createPool({
        host: config.HOST,
        user: config.USER,
        password: config.PSWD,
        database: config.DB,
        port: config.PORT,
    });
};

function query(sql, callback) {
    pool.getConnection(function (err, conn) {
        if (err) {
            callback(err, null, null);
        } else {
            conn.query(sql, function (qerr, vals, fields) {
                //释放连接  
                conn.release();
                //事件驱动回调  
                callback(qerr, vals, fields);
            });
        }
    });
}

function nop(a, b, c, d, e, f, g) {

}

exports.get_user_data = function (account, callback) {
    callback = callback == null ? nop : callback;
    if (account == null) {
        callback(null);
        return;
    }

    var sql = 'SELECT userid,account,name,lv,exp,coins,gems,roomid FROM t_users WHERE account = "' + account + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }

        if (rows.length == 0) {
            callback(null);
            return;
        }
        rows[0].name = crypto.fromBase64(rows[0].name);
        callback(rows[0]);
    });
};
exports.create_user = function (account, name, coins, gems, sex, headimg, callback) {
    callback = callback == null ? nop : callback;
    if (account == null || name == null || coins == null || gems == null) {
        callback(false);
        return;
    }
    if (headimg) {
        headimg = '"' + headimg + '"';
    }
    else {
        headimg = 'null';
    }
    name = crypto.toBase64(name);
    var sql = 'INSERT INTO t_users(account,name,coins,gems,sex,headimg) VALUES("{0}","{1}",{2},{3},{4},{5})';
    sql = sql.format(account, name, coins, gems, sex, headimg);
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            throw err;
        }
        callback(true);
    });
};
exports.get_room_id_of_user = function (userId, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'SELECT roomid FROM t_users WHERE userid = "' + userId + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }
        else {
            if (rows.length > 0) {
                callback(rows[0].roomid);
            }
            else {
                callback(null);
            }
        }
    });
};

exports.is_user_exist = function (account, callback) {
    callback = callback == null ? nop : callback;
    if (account == null) {
        callback(false);
        return;
    }

    var sql = 'SELECT userid FROM t_users WHERE account = "' + account + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            throw err;
        }

        if (rows.length == 0) {
            callback(false);
            return;
        }

        callback(true);
    });
}

exports.get_gems = function (account, callback) {
    callback = callback == null ? nop : callback;
    if (account == null) {
        callback(null);
        return;
    }

    var sql = 'SELECT gems FROM t_users WHERE account = "' + account + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }

        if (rows.length == 0) {
            callback(null);
            return;
        }

        callback(rows[0]);
    });
};
exports.update_user_history = function (userId, history, callback) {
    callback = callback == null ? nop : callback;
    if (userId == null || history == null) {
        callback(false);
        return;
    }

    history = JSON.stringify(history);
    var sql = 'UPDATE t_users SET roomid = null, history = \'' + history + '\' WHERE userid = "' + userId + '"';
    //console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }

        if (rows.length == 0) {
            callback(false);
            return;
        }

        callback(true);
    });
};
exports.create_game = function (room_uuid, index, base_info, callback) {
    callback = callback == null ? nop : callback;
    var sql = "INSERT INTO t_games(room_uuid,game_index,base_info,create_time) VALUES('{0}',{1},'{2}',unix_timestamp(now()))";
    sql = sql.format(room_uuid, index, base_info);
    //console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }
        else {
            callback(rows.insertId);
        }
    });
};
exports.get_user_history = function (userId, callback) {
    callback = callback == null ? nop : callback;
    if (userId == null) {
        callback(null);
        return;
    }

    var sql = 'SELECT history FROM t_users WHERE userid = "' + userId + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }

        if (rows.length == 0) {
            callback(null);
            return;
        }
        var history = rows[0].history;
        if (history == null || history == "") {
            callback(null);
        }
        else {
            console.log(history.length);
            history = JSON.parse(history);
            callback(history);
        }
    });
};
exports.create_room = function (roomId, conf, ip, port, create_time, callback) {
    callback = callback == null ? nop : callback;
    var sql = "INSERT INTO t_rooms(uuid,id,base_info,ip,port,create_time) \
                VALUES('{0}','{1}','{2}','{3}',{4},{5})";
    var uuid = Date.now() + roomId;
    var baseInfo = JSON.stringify(conf);
    sql = sql.format(uuid, roomId, baseInfo, ip, port, create_time);
    console.log(sql);
    query(sql, function (err, row, fields) {
        if (err) {
            callback(null);
            throw err;
        }
        else {
            callback(uuid);
        }
    });
};
exports.delete_room = function (roomId, callback) {
    callback = callback == null ? nop : callback;
    if (roomId == null) {
        callback(false);
    }
    var sql = "DELETE FROM t_rooms WHERE id = '{0}'";
    sql = sql.format(roomId);
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
}
exports.is_room_exist = function (roomId, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'SELECT * FROM t_rooms WHERE id = "' + roomId + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(rows.length > 0);
        }
    });
};

exports.get_room_addr = function (roomId, callback) {
    callback = callback == null ? nop : callback;
    if (roomId == null) {
        callback(false, null, null);
        return;
    }

    var sql = 'SELECT ip,port FROM t_rooms WHERE id = "' + roomId + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false, null, null);
            throw err;
        }
        if (rows.length > 0) {
            callback(true, rows[0].ip, rows[0].port);
        }
        else {
            callback(false, null, null);
        }
    });
};

exports.update_seat_info = function (roomId, seatIndex, userId, icon, name, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'UPDATE t_rooms SET user_id{0} = {1},user_icon{0} = "{2}",user_name{0} = "{3}" WHERE id = "{4}"';
    name = crypto.toBase64(name);
    sql = sql.format(seatIndex, userId, icon, name, roomId);
    //console.log(sql);
    query(sql, function (err, row, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
};

exports.set_room_id_of_user = function (userId, roomId, callback) {
    callback = callback == null ? nop : callback;
    if (roomId != null) {
        roomId = '"' + roomId + '"';
    }
    var sql = 'UPDATE t_users SET roomid = ' + roomId + ' WHERE userid = "' + userId + '"';
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            console.log(err);
            callback(false);
            throw err;
        }
        else {
            callback(rows.length > 0);
        }
    });
};
exports.get_room_data = function (roomId, callback) {
    callback = callback == null ? nop : callback;
    if (roomId == null) {
        callback(null);
        return;
    }

    var sql = 'SELECT * FROM t_rooms WHERE id = "' + roomId + '"';
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(null);
            throw err;
        }
        if (rows.length > 0) {
            rows[0].user_name0 = crypto.fromBase64(rows[0].user_name0);
            rows[0].user_name1 = crypto.fromBase64(rows[0].user_name1);
            rows[0].user_name2 = crypto.fromBase64(rows[0].user_name2);
            rows[0].user_name3 = crypto.fromBase64(rows[0].user_name3);
            callback(rows[0]);
        }
        else {
            callback(null);
        }
    });
};

exports.cost_gems = function (userid, cost, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'UPDATE t_users SET gems = gems -' + cost + ' WHERE userid = ' + userid;
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(rows.length > 0);
        }
    });
};

exports.delete_games = function (room_uuid, callback) {
    callback = callback == null ? nop : callback;
    if (room_uuid == null) {
        callback(false);
    }
    var sql = "DELETE FROM t_games WHERE room_uuid = '{0}'";
    sql = sql.format(room_uuid);
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
}
exports.archive_games = function (room_uuid, callback) {
    callback = callback == null ? nop : callback;
    if (room_uuid == null) {
        callback(false);
    }
    var sql = "INSERT INTO t_games_archive(SELECT * FROM t_games WHERE room_uuid = '{0}')";
    sql = sql.format(room_uuid);
    console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            exports.delete_games(room_uuid, function (ret) {
                callback(ret);
            });
        }
    });
}

/**
 * 结算相关
 */
exports.update_next_button = function (roomId, nextButton, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'UPDATE t_rooms SET next_button = {0} WHERE id = "{1}"'
    sql = sql.format(nextButton, roomId);
    //console.log(sql);
    query(sql, function (err, row, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
};
exports.update_game_result = function (room_uuid, index, result, callback) {
    callback = callback == null ? nop : callback;
    if (room_uuid == null || result) {
        callback(false);
    }

    result = JSON.stringify(result);
    var sql = "UPDATE t_games SET result = '" + result + "' WHERE room_uuid = '" + room_uuid + "' AND game_index = " + index;
    //console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
};
exports.update_game_action_records = function (room_uuid, index, actions, callback) {
    callback = callback == null ? nop : callback;
    var sql = "UPDATE t_games SET action_records = '" + actions + "' WHERE room_uuid = '" + room_uuid + "' AND game_index = " + index;
    //console.log(sql);
    query(sql, function (err, rows, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
};
exports.update_num_of_turns = function (roomId, numOfTurns, callback) {
    callback = callback == null ? nop : callback;
    var sql = 'UPDATE t_rooms SET num_of_turns = {0} WHERE id = "{1}"'
    sql = sql.format(numOfTurns, roomId);
    //console.log(sql);
    query(sql, function (err, row, fields) {
        if (err) {
            callback(false);
            throw err;
        }
        else {
            callback(true);
        }
    });
};
