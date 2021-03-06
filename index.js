/**
 * mediaserver module for node.js
 *
 * MIT license, Oguz Bastemur 2014-2018, edited by Timo Geier 2019
 */

var fs = require('fs'),
  exts = require('./libs/exts'),
  pathModule = require('path');

var pipe_extensions = {};
var pipe_extension_id = 0;

var shared = {};
var fileInfo = function (path) {
  if (path) {
    if (!exports.noCache && shared[path]) {
      return shared[path];
    }
    else {
      if (!fs.existsSync(path)) {
        return null;
      }
      var stat = fs.statSync(path);
      if (!exports.noCache)
        shared[path] = stat.size;

      return stat.size;
    }
  }
  return 0;
};

// set this to true for development mode
exports.noCache = false;
exports.mediaTypes = exts;

var getRange = function (req, total) {
  let chunksize = 131072;
  var range = [0, total, 0];
  var rinfo = req.headers ? req.headers.range : null;

  if (rinfo) {
    var rloc = rinfo.indexOf('bytes=');
    if (rloc >= 0) {
      var ranges = rinfo.substr(rloc + 6).split('-');
      try {
        range[0] = parseInt(ranges[0]);

        // if (ranges[1] && ranges[1].length) {
        // if (ranges[1]) {
          range[1] = parseInt(range[0] + chunksize < total ? range[0] + chunksize : total);
          range[1] = range[1] < 16 ? 16 : range[1];
        // }
      } catch (e) {}
    }

    if (range[1] == total)
     range[1]--;

    range[2] = total;
  }

  return range;
};


var isString = function (str) {
  if (!str) return false;
  return (typeof str == 'string' || str instanceof String);
};


exports.pipe = function (req, res, path, type, opt_cb) {
  if (!isString(path)) {
    throw new TypeError("path must be a string value");
  }

  var total = fileInfo(path);

  if (total == null) {
    res.end(path + " not found");
    return false;
  }

  var range = getRange(req, total);

  var ext = pathModule.extname(path).toLowerCase();
  if (!type && ext && ext.length) {
    type = exts[ext];
  }

  if (type && type.length && type[0] == '.') {
    ext = type;
    type = exts[type];
  }

  if (!type || !type.length) {
    res.write("Media format not found for " + pathModule.basename(path));
  } else {
    var file = fs.createReadStream(path, {start: range[0], end: range[1]});

    var cleanupFileStream = function() {
      file.close();
    }

    // the event emitted seems to change based on version of node.js
    // 'close' is fired as of v6.11.5
    res.on('close', cleanupFileStream); // https://stackoverflow.com/a/9021242
    res.on('end', cleanupFileStream);  // https://stackoverflow.com/a/16897986
    res.on('finish', cleanupFileStream); // https://stackoverflow.com/a/14093091 - https://stackoverflow.com/a/38057516

    if (!ext.length || !pipe_extensions[ext]) {
      var header = {
        'Content-Length': range[1] - range[0],
        'Content-Type': type,
        'Access-Control-Allow-Origin': req.headers.origin || "*",
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'POST, GET, OPTIONS'
      };

      if (range[2]) {
        header['Accept-Ranges'] = 'bytes';
        header['Content-Range'] = 'bytes ' + range[0] + '-' + range[1] + '/' + total;
        header['Content-Length'] = range[1] - range[0];

        res.writeHead(206, header);
      } else {
        res.writeHead(200, header);
      }

      file.pipe(res);
      file.on('close', function () {
        res.end(0);
        if (opt_cb && typeof opt_cb == 'function') {
          opt_cb(path);
        }
      });
    } else {
      var _exts = pipe_extensions[ext];
      res.writeHead(200,
        {
          'Content-Type': type,
          'Access-Control-Allow-Origin': req.headers.origin || "*",
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'POST, GET, OPTIONS'
        });
      for (var o in _exts) {
        _exts[o](file, req, res, function () {
          if (!res.__ended) {
            res.__ended = true;
            res.end(0);
          }
        });
      }
    }

    return true;
  }

  return false;
};

exports.on = function (ext, m) {
  if (!pipe_extensions[ext]) {
    pipe_extensions[ext] = [];
  }

  m.pipe_extension_id = pipe_extension_id++;
  m.pipe_extension = ext;

  pipe_extensions[ext].push(m);
};

exports.removeEvent = function (method) {
  if (!method || !method.pipe_extension || !method.pipe_extension_id) {
    return;
  }

  if (pipe_extensions[method.pipe_extension]) {
    var exts = pipe_extensions[method.pipe_extension];
    for (var i = 0, ln = exts.length; i < ln; i++) {
      if (exts[i].pipe_extension_id == method.pipe_extension_id) {
        pipe_extensions[method.pipe_extension] = exts.splice(i, 1);
      }
    }
  }
};
