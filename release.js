/*
 * fis
 * http://fis.baidu.com/
 */

'use strict';

exports.name = 'release [media name]';
exports.desc = 'build and deploy your project';
exports.run = function(argv, cli) {

  // 显示帮助信息
  if (argv.h || argv.help) {
    return cli.help(exports.name, {
      '-h, --help': 'print this help message',
      '-d, --dest <names>': 'release output destination',
      '-w, --watch': 'monitor the changes of project',
      '-L, --live': 'automatically reload your browser',
      '-c, --clean': 'clean compile cache',
      '-u, --unique': 'use unique compile caching'
    });
  }

  // 如果指定了 media 值
  if (argv._[1]) {
    process.env.NODE_ENV = argv._[1];
  }

  var options = {
    dest: argv.dest || argv.d || 'preview',
    watch: !!(argv.watch || argv.w),
    live: !!(argv.live || argv.L),
    clean: !!(argv.clean || argv.c),
    unique: !!(argv.unique || argv.u),
    verbose: !!argv.verbose
  };

  function watch(opt) {
    var root = fis.project.getProjectPath();
    var timer = -1;

    function listener(type) {
      clearTimeout(timer);
      timer = setTimeout(function() {
        release(opt);
      }, 500);
    }

    require('chokidar')
      .watch(root, {
        ignored: function(path) {
          if (path.indexOf(root) === 0) {
            path = path.substring(root.length);
          }

          path = path.replace(/\\/g, '/');

          var partten = fis.get('project.watch.exclude', fis.get('project.exclude'));

          return partten ? partten.test(path) : false;
        },
        usePolling: fis.get('project.watch.usePolling', null),
        persistent: true
      })
      .on('add', listener)
      .on('change', listener)
      .on('unlink', listener)
      .on('unlinkDir', listener)
      .on('error', function(err) {
        //fis.log.error(err);
      });
  }

  function time(fn) {
    process.stdout.write('\n δ '.bold.yellow);
    var now = Date.now();
    fn();
    process.stdout.write((Date.now() - now + 'ms').green.bold);
    process.stdout.write('\n');
  }

  var LRServer, LRTimer;

  function reload() {
    if (LRServer && LRServer.connections) {
      fis.util.map(LRServer.connections, function(id, connection) {
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
          delete LRServer.connections[id];
        }
      });
    }
  }

  var lastModified = {};
  var collection = {};
  var total = {};
  var deploy = require('./lib/deploy.js');

  deploy.done = function() {
    clearTimeout(LRTimer);
    LRTimer = setTimeout(reload, 200);
  };

  function release(opt) {
    var flag, start = Date.now();
    process.stdout.write('\n Ω '.green.bold);
    opt.beforeEach = function(file) {
      flag = opt.verbose ? '' : '.';
      file.__start = (new Date).getTime();
      total[file.subpath] = file;
    };
    opt.afterEach = function(file) {
      //cal compile time
      var cost = (new Date).getTime() - file.__start;
      if (cost > 200) {
        flag = flag.bold.yellow;
        fis.log.debug(file.realpath);
      } else if (cost < 100) {
        flag = flag.grey;
      }
      var mtime = file.getMtime().getTime();
      //collect file to deploy
      if (file.release && lastModified[file.subpath] !== mtime) {
        if (!collection[file.subpath]) {
          process.stdout.write(flag);
        }
        lastModified[file.subpath] = mtime;
        collection[file.subpath] = file;
      }
    };

    opt.beforeCompile = function(file) {
      collection[file.subpath] = file;
      process.stdout.write(flag);
    };

    try {
      //release
      fis.release(opt, function(ret) {
        process.stdout.write(
          (opt.verbose ? '' : ' ') +
          (Date.now() - start + 'ms').bold.green + '\n'
        );
        var changed = false;
        fis.util.map(collection, function(key, file) {
          //get newest file from src
          collection[key] = ret.src[key] || file;
          changed = true;
        });
        if (changed) {
          if (opt.unique) {
            time(fis.compile.clean);
          }
          fis.util.map(ret.pkg, function(subpath, file) {
            collection[subpath] = file;
            total[subpath] = file;
          });
          deploy(opt, collection, total);
          collection = {};
          total = {};
          return;
        }
      });
    } catch (e) {
      process.stdout.write('\n [ERROR] ' + (e.message || e) + '\n');
      if (opt.watch) {
        // alert
        process.stdout.write('\u0007');
      } else if (opt.verbose) {
        throw e;
      } else {
        process.exit(1);
      }
    }
  }

  fis.log.throw = true;

  if (options.clean) {
    time(function() {
      fis.cache.clean('compile');
    });
  }
  delete options.clean;

  if (options.live) {
    var LiveReloadServer = require('livereload-server-spec');
    var port = fis.config.get('livereload.port', 8132);
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
    //fix mac livereload
    process.on('uncaughtException', function(err) {
      if (err.message !== 'read ECONNRESET') throw err;
    });
    //delete options.live;
  }

  if (options.watch) {
    watch(options);
  } else {
    release(options);
  }
};
