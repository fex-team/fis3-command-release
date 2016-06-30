var _ = fis.util;
var portfinder = require('portfinder');
var rLivereload = /"(?:[^\\"\r\n\f]|\\[\s\S])*"|'(?:[^\\'\n\r\f]|\\[\s\S])*'|(<\/body>|<!--livereload-->)/ig;
var LRServer;
var LRPORT;

function makeLiveServer(callback) {
  if (LRServer) return callback(null, LRServer, LRPORT);

  var basePort = fis.media().get('livereload.port', 8132);

  // 获取下一个可用端口。
  portfinder.getPort({
    port: basePort
  }, function(error, port) {
    if (error) {
      fis.log.warn('The port %s for livereload is already in use!', basePort);
      return callback(error);
    }

    LRPORT = port;
    var LiveReloadServer = require('livereload-server-spec');

    LRServer = new LiveReloadServer({
      id: 'com.baidu.fis',
      name: 'fis-reload',
      version: fis.cli.info.version,
      port: port,
      protocols: {
        monitoring: 7
      }
    });

    LRServer.on('livereload.js', function(req, res) {
      var script = fis.util.fs.readFileSync(__dirname + '/../vendor/livereload.js');
      res.writeHead(200, {
        'Content-Length': script.length,
        'Content-Type': 'text/javascript',
        'Connection': 'close'
      });
      res.end(script);
    });

    LRServer.listen(function(err) {
      if (err) {
        err.message = 'LiveReload server Listening failed: ' + err.message;
        fis.log.error(err);
      }
    });

    process.stdout.write('\n Ψ '.bold.yellow + port + '\n');

    // fix mac livereload
    process.on('uncaughtException', function(err) {
      if (err.message !== 'read ECONNRESET') throw err;
    });


    callback(null, LRServer, LRPORT);
  });
}

function reload(callback) {
  makeLiveServer(function(error, server) {
    if (error) {
      return callback(error);
    }

    if (server && server.connections) {
      _.map(server.connections, function(id, connection) {
        try {
          connection.send({
            command: 'reload',
            path: '*',
            liveCSS: true
          });
        } catch (e) {
          try {
            connection.close();
          } catch (e) {}
          delete server.connections[id];
        }
      });
    }

    callback(null);
  });
}

function handleReloadComment(obj, next) {
  var isLiveMod = obj.options.live;

  fis.log.debug('handle reload comment start');

  if (isLiveMod) {
    makeLiveServer(function(error, server, port) {
      if (error) {
        return next(error);
      }

      var hostname = fis.config.get('livereload.hostname');
      var livereloadScript = _.template([
        '<script>',
          '(function(w,d,h,p){',
            'if(w.WebSocket||w.MozWebSocket){',
              'var s=d.createElement("script");',
              's.src="//"+h+":"+p+"/livereload.js";',
              'd.head.appendChild(s)',
            '}',
          '})(this,document,<%= hostname %>,<%= port %>)',
        '</script>'
      ].join(''))({
        hostname: hostname ? '"' + hostname + '"' : 'location.hostname',
        port: port
      });

      _.toArray(obj.modified).forEach(function(file) {
        var content = file.getContent();
        var bingo = false;

        if (!file.isHtmlLike || typeof content !== 'string') {
          return;
        }

        rLivereload.lastIndex = 0;
        content = content.replace(rLivereload, function(all, token) {
          if (token && !bingo) {
            bingo = true;
            return livereloadScript + token;
          }
          return all;
        });

        file.setContent(content);
      });

      fis.log.debug('handle reload comment end');
      next(null, obj);
    });
  } else {
    _.toArray(obj.modified).forEach(function(file) {
      var content = file.getContent();

      if (!file.isHtmlLike || typeof content !== 'string') {
        return;
      }

      content = content.replace(/<!--livereload-->/ig, '');
      file.setContent(content);
    });

    fis.log.debug('handle reload comment end');
    next(null, obj);
  }

};

function checkReload(obj, next) {
  reload(function() {
    next(null, obj)
  });
}

exports.checkReload = checkReload;
exports.handleReloadComment = handleReloadComment;
