var checkIgnore = require('./checkignore.js');
var _ = fis.util;
var chokidar = require('chokidar');
var util = require('util');
var path = require('path');

var patterns, root;

function isMaster() {
  var argv = process.argv;
  return !~argv.indexOf('--child-flag');
}

// 判断新加的文件是否满足用户指定。
function match(path) {

  if (!patterns) {
    patterns = fis.media().get('project.files', []);

    if (!Array.isArray(patterns)) {
      patterns = [patterns];
    }

    patterns = patterns.map(function(pattern) {
      var negate = false;

      if (pattern[0] === '!') {
        negate = true;
        pattern = pattern.substring(1);
      }

      pattern[0] === '/' && (pattern = pattern.substring(1));

      return {
        negate: negate,
        reg: _.glob(pattern)
      };
    });
  }

  path.indexOf(root) === 0 && (path = path.substring(root.length));

  var hitted = false;
  patterns.forEach(function(item) {
    if (hitted) {
      if (item.negate && item.reg.test(path)) {
        hitted = false;
      }
    } else {
      hitted = item.negate !== item.reg.test(path);
    }
  });

  return hitted;
}

var child_process = require('child_process');

// 当监听到 fis-conf.js 文件变化的时候，kill self 重启一个新进程。
function respawn() {
  var argv = process.argv;
  var child = child_process.spawn(argv[0], argv.slice(1).concat('--child-flag'));
  child.stderr.pipe(process.stderr);
  child.stdout.on('data', function(data) {
    if (~data.toString('utf-8').indexOf('Currently running fis3')) {
      return;
    }
    process.stdout.write(data);
  });
  child.on('exit', function(code, signal) {
    process.on('exit', function() {
      if (signal) {
        process.kill(process.pid, signal);
      } else {
        process.exit(code);
      }
    });
  });
  return child;
}

function onFisConfChange() {
  var argv = process.argv.slice(3);
  argv.pop();
  fis.log.info('Detect `fis-conf.js` modified, respawn `%s release %s`.', fis.cli.name, argv.join(' '));
  process.exit();
}

var watcher;
var watchList = [];
var affectedList = [];

function watch(options, next) {
  // 用子进程去 watch.
  if (isMaster()) {
    return (function() {
      var damen = arguments.callee;
      var child = respawn();

      child.on('exit', function(code) {
        code || damen();
      });
    })();
  }

  root = fis.project.getProjectPath();

  var opts = {
    usePolling: false,
    persistent: true,
    ignoreInitial: true,
    followSymlinks: true,
    ignored: function(filepath) {

      // normalize filepath
      filepath = filepath.replace(/\\/g, '/');
      filepath.indexOf(root) === 0 && (filepath = filepath.substring(root.length));

      // todo 暂时不支持 -f 参数指定其他配置文件。
      if (filepath === '/fis-conf.js') {
        return false;
      }

      return checkIgnore(filepath);
    }
  };

  _.assign(opts, fis.get('project.watch', {}));

  var busy = false;
  var timer;
  var latestTotal;

  // 当后续的流程全部跑完后执行。
  function done(error, ret) {
    busy = false;

    if (!error) {

      // 将所有相关的文件，都加入 watchList
      Object.keys(ret.total).forEach(function(filepath) {
        var file = ret.total[filepath];

        filepath = fis.util(root, filepath);
        ~watchList.indexOf(filepath) || watchList.push(filepath);

        /*file.links.forEach(function(filepath) {
          filepath = fis.util(root, filepath);
          ~watchList.indexOf(filepath) || watchList.push(filepath);
        });

        if (file.cache) {
          _.forEach(file.cache.deps, function(mtime, filepath) {
            ~watchList.indexOf(filepath) || watchList.push(filepath);
          });
        }*/
      });

      latestTotal = ret.total;
      process.stdout.write(util.format(' [%s]\n'.grey, fis.log.now()))

      affectedList.length && setTimeout(release, 200);
    }
  }

  var files = fis.project.getSource();

  // todo 看似 srcCache 并没有什么用，可以尝试删除。
  var srcCache = options.srcCache = options.srcCache || [];
  fis.util.map(files, function(subpath, file) {
    srcCache.push(file.realpath);
  });

  // var safePathReg = /[\\\/][_\-.\s\w]+$/i;
  var safePathReg = /(?:\\|\/)[-\w^&'@{}[\],$=!#().%+~ ]+$/;

  // 获取受影响的文件列表.
  function getAffectedFiles(map, list) {
    list = list ? list.concat() : [];

    Object.keys(map).forEach(function(subpath) {
      var file = map[subpath];

      if (!file.useCache) {
        list.unshift(file.realpath);
        return;
      }

      if (file.cache && file.cache.deps) {
        var flag = false;

        list.every(function(realpath) {
          if (file.cache.deps[realpath]) {
            flag = true;
            return false;
          }

          return true;
        });

        if (flag) {
          list.unshift(file.realpath);
        }
      }

      // mDeps 记录的是当时并不存在的依赖文件。
      if (file.cache && file.cache.mDeps) {
        var flag2 = false;

        list.every(function(realpath) {
          if (file.cache.mDeps[realpath]) {
            flag2 = true;
            return false;
          }

          return true;
        });

        if (flag2) {
          list.unshift(file.realpath);
        }
      }
    });

    return list;
  }

  function listener(type) {
    return function(path) {
      fis.log.debug('Watch Event %s, path: %s', type, path);
      var affectedToCheck = [];

      if (path && safePathReg.test(path)) {
        var modified = false;
        path = fis.util(path);
        var subpath = path.substring(root.length);

        if (subpath === '/fis-conf.js') {
          return onFisConfChange();
        }

        if (type === 'add' || type === 'change') {
          ~srcCache.indexOf(path) ||
            match(path) && (srcCache.push(path), modified = true);

          if (!modified && ~watchList.indexOf(path)) {
            modified = true;
          }

          affectedToCheck.push(path);
        } else if (type === 'addDir') {
          var entries = fis.project.getSourceByPatterns(subpath + '/**');

          Object.keys(entries).forEach(function(subpath) {
            var path = root + subpath;
            modified = true;

            ~srcCache.indexOf(path) || srcCache.push(path);
            affectedToCheck.push(path);
          });
        } else if (type === 'unlink') {
          var idx = watchList.indexOf(path);
          delete latestTotal[subpath];

          if (~idx) {
            watchList.splice(idx, 1);
            modified = true;
          }

          idx = srcCache.indexOf(path);

          if (~idx) {
            srcCache.splice(idx, 1);
            modified = true;
          }
          affectedToCheck.push(path);
        } else if (type === 'unlinkDir') {
          var toDelete = [];

          watchList.forEach(function(realpath, index) {
            if (realpath.indexOf(path) === 0) {
              toDelete.unshift(index);

              var filepath = watchList[index];
              var subpath = filepath.substring(root.length);
              affectedToCheck.push(filepath);

              delete latestTotal[subpath];
            }
          });

          toDelete.forEach(function(index) {
            watchList.splice(index, 1);
            modified = true;
          });

          toDelete = [];
          srcCache.forEach(function(realpath, index) {
            if (realpath.indexOf(path) === 0) {
              toDelete.unshift(index);
            }
          });

          toDelete.forEach(function(index) {
            srcCache.splice(index, 1);
            modified = true;
          });
        }

        // 没有修改，直接跳过。
        if (!modified || !affectedToCheck.length) {
          return;
        }

        getAffectedFiles(latestTotal, affectedToCheck).forEach(function(filepath) {
          ~affectedList.indexOf(filepath) || affectedList.push(filepath);
        });
      }

      if (busy) return;

      if (type === 'inital') {
        busy = true;
        next(null, options, done);
      } else {
        clearTimeout(timer);
        timer = setTimeout(release, 200);
      }
    }
  }

  function release() {
    busy = true;

    options.total = latestTotal;
    options.srcCache = affectedList.splice(0, affectedList.length);

    next(null, _.assign({
      fromWatch: true
    }, options), done);
  }

  watcher = chokidar
    .watch(root, opts)
    .on('add', listener('add'))
    .on('addDir', listener('addDir'))
    .on('change', listener('change'))
    .on('unlink', listener('unlink'))
    .on('unlinkDir', listener('unlinkDir'))
    .on('error', function(err) {
      err.message += fis.cli.colors.red('\n\tYou can set `fis.config.set("project.watch.usePolling", true)` fix it.');
      fis.log.error(err);
    });

  opts.ignoreInitial && listener('inital')();
}

module.exports = watch;
