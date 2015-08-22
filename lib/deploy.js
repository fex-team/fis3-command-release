var _ = fis.util;
var makeChains = require('./chains.js');

function filter(hash, item) {

  // 快速查找
  if (typeof item.raw === 'string' && hash[item.raw]) {
    return [hash[item.raw]];
  }

  var reg = item.reg;

  return _.toArray(hash).filter(function(file) {
    reg.lastIndex = 0;
    return (reg === '**' || reg.test(file.subpath)) !== item.negate;
  });
}

function callPlugin(dest, info/*, args...*/) {
  var args = [].slice.call(arguments, 2);
  var plugin = info;

  if (typeof plugin !== 'function') {
    var pluginName = plugin.__name || plugin;
    plugin = fis.require('deploy-' + pluginName);
  }

  if (typeof plugin !== 'function') {
    throw new Error('The plugin is not callable!');
  }

  var options = {};
  _.assign(options, plugin.defaultOpitons || plugin.options || {});
  _.isPlainObject(info) && _.assign(options, info);

  // 命令行指定位置。
  options.dest = dest;

  args.unshift(options);
  return plugin.apply(null, args);
}

/**
 * Obj 说明
 *
 * - modified 修改过的文件
 * - total 所有文件
 * - options release 配置项
 */
module.exports = function(obj, callback) {
  var total = obj.total;
  var modified = obj.modified;
  var chains = makeChains();

  if (_.isEmpty(modified)) {
    return callback();
  }

  var matches = fis
    .media()
    .getSortedMatches()
    .filter(function(item) {
      return item.properties.deploy;
    });

  if (!matches.length) {
    matches.push({
      reg: _.glob('**'),
      raw: '**',
      properties: {
        deploy: [
          fis.plugin('encoding'),
          fis.plugin('local-deliver')
        ]
      }
    });
  }

  var groups = matches.map(function(item) {
    var list = filter(modified, item);
    var all = filter(total, item);
    var tasks = item.properties.deploy;

    if (typeof tasks === 'string') {
      tasks = tasks.split(/\s*,\s*/);
    } else if (!Array.isArray(tasks)) {
      tasks = [tasks];
    }

    return {
      modified: list,
      total: all,
      tasks: tasks
    };
  });

  var assignedTotal = [];
  var assignedModified = [];
  _.eachRight(groups, function(group) {
    group.modified = _.difference(group.modified, assignedModified);
    group.total = _.difference(group.total, assignedTotal);

    assignedModified.push.apply(assignedModified, group.modified);
    assignedTotal.push.apply(assignedTotal, group.total);
  });

  groups.forEach(function(group) {
    var list = group.modified;
    var all = group.total;
    var tasks = group.tasks;

    chains.use(function(v, next) {
      var subchains = makeChains();

      tasks.forEach(function(plugin) {
        subchains.use(function(v, next) {
          var ret = callPlugin(obj.options.dest, plugin, list, all, next);

          // 当有返回值时，表示不是异步，不需要等待。
          if (typeof ret !== 'undefined') {
            next(null, ret);
          }
        });
      });

      subchains.use(next);
      subchains.run();
    });
  });


  chains.use(callback);
  chains.run();
};
