var _ = fis.util;
var deploy = require('./lib/deploy.js');

exports.name = 'release [media name]';
exports.desc = 'build and deploy your project';
exports.options = {
  '-h, --help': 'print this help message',
  '-d, --dest <path>': 'release output destination',
  '-w, --watch': 'monitor the changes of project',
  '-L, --live': 'automatically reload your browser',
  '-c, --clean': 'clean compile cache',
  '-u, --unique': 'use unique compile caching'
};

exports.run = function(argv, cli) {

  // 显示帮助信息
  if (argv.h || argv.help) {
    return cli.help(exports.name, exports.options);
  }

  // 如果指定了 media 值
  if (argv._[1]) {
    process.env.NODE_ENV = argv._[1];
  }

  // normalize options
  var options = {
    dest: argv.dest || argv.d || 'preview',
    watch: !!(argv.watch || argv.w),
    live: !!(argv.live || argv.L),
    clean: !!(argv.clean || argv.c),
    unique: !!(argv.unique || argv.u),
    verbose: !!argv.verbose
  };

  var app = require('./lib/chains.js')();

  app.use(bootstrap);
  options.watch && app.use(watch);
  app.use(release);

  // deliver
  app.use(function(info, next) {
    deploy(info, function() {
      next(info);
    });
  });
  options.live && app.use(checkReload);
  app.run(options);

  // --------------------------------------------
  //
  var stream = process.stdout;

  function bootstrap(options, next) {

    // clear cache?
    if (options.clean) {
      time(function() {
        fis.cache.clean('compile');
      });
    }

    next(options);
  }

  function time(fn) {
    stream.write('\n δ '.bold.yellow);
    var now = Date.now();
    fn();
    stream.write((Date.now() - now + 'ms').green.bold);
    stream.write('\n');
  }

  function watch(options, next) {
    var root = fis.project.getProjectPath();
    var opts = {
      usePolling: false,
      persistent: true,
      ignored: function(path) {
        path.indexOf(root) === 0 && (path = path.substring(root.length));

        // normalize path
        path = path.replace(/\\/g, '/');

        var partten = fis.get('project.watch.exclude') || fis.get('project.exclude');
        return partten ? partten.test(path) : false;
      }
    };

    fis.get('project.watch') && _.assign(opts, fis.get('project.watch'));

    var busy = false;
    function done() {
      busy = false;
    }

    function listener(type) {
      if (busy)return;
      busy = true;
      console.log('buzing');
      next(options, done);
    }

    require('chokidar')
      .watch(root, opts)
      .on('add', listener)
      .on('change', listener)
      .on('unlink', listener)
      .on('unlinkDir', listener)
      .on('error', function(err) {
        //fis.log.error(err);
      });
  }

  var lastModified = {};
  function release(options, next) {

    stream.write('\n Ω '.green.bold);
    var verbose = options.verbose;

    var alertDurtion = 1000; // 1s
    var alertCacheDurtion = 200; // 200ms

    var total = {};
    var modified = {};

    options.beforeEach = function(file) {
      file._start = Date.now(); // 记录起点
      total[file.subpath] = file;
    };

    options.beforeCompile = function(file) {
      modified[file.subpath] = file;
    };

    options.afterEach = function(file) {
      var fromCache = !modified[file.subpath];
      var cost = Date.now() - file._start;
      var flag = fromCache ? (cost > alertCacheDurtion ? '.'.bold.yellow : '.'.grey) : (cost > alertDurtion ? '.'.bold.yellow : '.');

      var mtime = file.getMtime().getTime();

      if (file.release && lastModified[file.subpath] !== mtime) {
        lastModified[file.subpath] = mtime;
        modified[file.subpath] = file;

        verbose ? fis.log.debug(file.realpath) : (modified[file.subpath] && stream.write(flag));
      }
    };

    try {
      var start = Date.now();
      fis.log.throw = true;

      // release
      fis.release(options, function(ret) {
        stream.write(fis.log.format('%s' + '%sms'.bold.green +'\n', verbose ? '' : ' ', Date.now() - start));

        var changed = !fis.util.isEmpty(modified);

        if (changed) {
          // clear cache
          if (options.unique) {
            time(fis.compile.clean);
          }

          fis.util.map(ret.pkg, function(subpath, file) {
            modified[subpath] = file;
            total[subpath] = file;
          });


          next({
            options: options,
            modified: modified,
            total: total
          });

          modified = {};
          total = {};
        }
      });
    } catch (e) {
      process.stdout.write('\n [ERROR] ' + (e.message || e) + '\n');
      fis.log.debug(e.stack);
      if (options.watch) {
        // alert
        process.stdout.write('\u0007');
      } else if (options.verbose) {
        throw e;
      } else {
        process.exit(1);
      }
    }
  }

  var LRServer;
  function makeLiveServer() {
    if (LRServer)return LRServer;

    var LiveReloadServer = require('livereload-server-spec');
    var port = fis.media().get('livereload.port', 8132);
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
      var script = fis.util.fs.readFileSync(__dirname + '/vendor/livereload.js');
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

    return LRServer;
  }

  function reload() {
    var server = makeLiveServer();

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
  }

  var reloadTimer;
  function checkReload(value, next) {
    makeLiveServer();

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(reload, fis.get('livereload.delay', 200));
    next();
  }
};
