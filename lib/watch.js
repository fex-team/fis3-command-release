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
    followSymlinks: false,
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
      Object.keys(ret.modified).forEach(function(filepath) {
        var file = ret.modified[filepath];

        filepath = fis.util(root, filepath);
        ~watchList.indexOf(filepath) || watchList.push(filepath);

        file.links.forEach(function(filepath) {
          filepath = fis.util(root, filepath);
          ~watchList.indexOf(filepath) || watchList.push(filepath);
        });

        if (file.cache) {
          _.forEach(file.cache.deps, function(mtime, filepath) {
            ~watchList.indexOf(filepath) || watchList.push(filepath);
          });
        }
      });

      latestTotal = ret.total;
      process.stdout.write(util.format(' [%s]\n'.grey, fis.log.now()))
    }
  }

  var files = fis.project.getSource();
  var srcCache = options.srcCache = options.srcCache || [];
  fis.util.map(files, function(subpath, file) {
    srcCache.push(file.realpath);
  });

  // var safePathReg = /[\\\/][_\-.\s\w]+$/i;
  var safePathReg = /(?:\\|\/)[-\w^&'@{}[\],$=!#().%+~ ]+$/;

  // 获取受影响的文件列表.
  function getAffectedFiles(file, map) {
    var list = [file.realpath];

    if (!file) {
      return list;
    }

    Object.keys(map).forEach(function(subpath) {
      var file = map[subpath];

      if (!file.useCache) {
        list.unshift(file.realpath);
      } if (file.cache && file.cache.deps) {
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
    });

    // var pending = [file];
    // var cache = {};

    // while (pending.length) {
    //   file = pending.shift();
    //   if (cache[file.realpath]) {
    //     continue;
    //   }

    //   if (file.cache && file.cache.deps) {
    //     var flag = false;

    //     list.every(function(realpath) {
    //       if (file.cache.deps[realpath]) {
    //         flag = true;
    //         return false;
    //       }

    //       return true;
    //     });

    //     if (flag) {
    //       list.unshift(file.realpath);
    //     }
    //   }

    //   if (file.links && file.links.length) {
    //     file.links.forEach(function(subpath) {
    //       if (map[subpath]) {
    //         pending.push(map[subpath]);
    //       }
    //     });
    //   }

    //   cache[file.realpath] = true;
    // }

    return list;
  }

  function listener(type) {
    return function(path) {
      fis.log.debug('Watch Event %s, path: %s', type, path);

      if (path && safePathReg.test(path)) {
        var modified = false;
        path = fis.util(path);
        var subpath = path.substring(root.length);

        if (path === root + '/fis-conf.js') {
          return onFisConfChange();
        }

        if (~watchList.indexOf(path)) {
          modified = true;
        }

        if (type === 'add' || type === 'change') {
          ~srcCache.indexOf(path) || match(path) &&
            (srcCache.push(path), modified = true);
        } else if (type === 'unlink') {
          var idx = watchList.indexOf(path);

          if (~idx) {
            watchList.splice(idx, 1);
            modified = true;
          }

          idx = srcCache.indexOf(path);

          if (~idx) {
            srcCache.splice(idx, 1);
            modified = true;
          }
        } else if (type === 'unlinkDir') {
          var toDelete = [];

          watchList.forEach(function(realpath, index) {
            if (realpath.indexOf(path) === 0) {
              toDelete.unshift(index);
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
        if (!modified) {
          return;
        }

        // 优化 add 和 change 只编译当前文件
        if (type === 'add' || type === 'change') {
          options.srcCache = [path];
          var file = latestTotal[subpath];

          if (file) {
            options.srcCache = getAffectedFiles(file, latestTotal);
          }

          //console.log(options.srcCache);
          options.total = latestTotal;
        } else {
          options.srcCache = srcCache.concat();
          options.total = {}; // 需要清空
        }
      }

      if (busy) return;

      if (type === 'inital') {
        busy = true;
        next(null, options, done);
      } else {
        clearTimeout(timer);
        timer = setTimeout(function() {
          busy = true;
          next(null, _.assign({
            fromWatch: true
          }, options), done);
        }, 200);
      }
    }
  }

  watcher = chokidar
    .watch(root, opts)
    .on('add', listener('add'))
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
