var _ = fis.util;
var deploy = require('./lib/deploy.js');
var checkIgnore = require('./lib/checkignore.js');

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

  // enable watch automatically when live is enabled.
  options.live && (options.watch = true);

  var app = require('./lib/chains.js')();
  var livereload = require('./lib/livereload.js');

  app.use(bootstrap);
  options.watch && app.use(watch);
  app.use(release);

  // 处理 livereload 脚本
  app.use(livereload.handleReloadComment);

  // deliver
  app.use(function(info, next) {
    fis.log.debug('deploy start');
    deploy(info, function(error) {
      fis.log.debug('deploy end');
      next(error, info);
    });
  });

  options.live && app.use(livereload.checkReload);

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

    next(null, options);
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
      ignoreInitial: true,
      followSymlinks: false,
      ignored: function(path) {

        // normalize path
        path = path.replace(/\\/g, '/');
        path.indexOf(root) === 0 && (path = path.substring(root.length));

        return checkIgnore(path);
      }
    };

    _.assign(opts, fis.get('project.watch', {}));

    var lastTime = 0;
    var busy = false;
    function done() {
      busy = false;
    }

    function listener() {

      // 没有 release 完，或者离上次 release 时间小于 200ms.
      // watch 可能同时触发好几种事件。
      if (busy || (Date.now() - lastTime) < 200)return;
      busy = true;
      lastTime = new Date();
      next(null, options, done);
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

    opts.ignoreInitial && listener('inital');
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
      file._fromCache = true;
    };

    options.beforeCompile = function(file) {
      file._fromCache = false;
      file.release !== false && (modified[file.subpath] = file);
    };

    options.afterEach = function(file) {
      var mtime = file.getMtime().getTime();
      var fromCache = file._fromCache;

      if (file.release && (!fromCache || lastModified[file.subpath] !== mtime)) {
        var cost = Date.now() - file._start;
        var flag = fromCache ? (cost > alertCacheDurtion ? '.'.bold.yellow : '.'.grey) : (cost > alertDurtion ? '.'.bold.yellow : '.');

        lastModified[file.subpath] = mtime;
        modified[file.subpath] = file;

        verbose ? fis.log.debug(file.realpath) : stream.write(flag);
      }
    };

    try {
      var start = Date.now();
      fis.log.throw = true;

      // release
      fis.release(options, function(ret) {
        stream.write(fis.log.format('%s' + '%sms'.bold.green +'\n', verbose ? '' : ' ', Date.now() - start));

        // clear cache
        options.unique && time(fis.compile.clean);

        _.map(ret.pkg, function(subpath, file) {
          modified[subpath] = file;
          total[subpath] = file;
        });

        next(null, {
          options: options,
          modified: modified,
          total: total
        });
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

      next(true);
    }
  }

  // run it.
  app.run(options);
};
