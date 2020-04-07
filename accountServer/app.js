var db = require('../utils/db');
var configs = require(process.argv[2]);

//init db pool.
db.init(configs.mysql());

var config = configs.account_server();
var as = require('./accountServer');
as.start(config);