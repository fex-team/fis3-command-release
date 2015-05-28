var _ = fis.util;
var makeChains = require('./chains.js');

/**
 * Obj 说明
 *
 * - modified 修改过的文件
 * - total 所有文件
 * - options release 配置项
 */
module.exports = function(obj, callback) {
  var total = _.toArray(obj.total);
  var modified = _.toArray(obj.modified);
  var chains = makeChains();

  function find(item) {

    // 快速查找
    if (typeof item.raw === 'string' && obj.modified[item.raw]) {
      return [obj.modified[item.raw]];
    }

    var reg = item.reg;

    return modified.filter(function(file) {
      reg.lastIndex = 0;
      return (reg === '**' || reg.test(file.subpath)) !== item.negate;
    });
  }

  function callPlugin(info/*, args...*/) {
    var args = [].slice.call(arguments, 1);
    var plugin = fis.require('deploy-' + info.__name);
    var options = {};

    if (typeof plugin !== 'function') {
      throw new Error('The plugin is not callable!');
    }

    _.assign(options, plugin.defaultOpitons || plugin.options || {});
    _.assign(options, info);

    // 命令行指定位置。
    options.dest = obj.options.dest;

    args.unshift(options);
    return plugin.apply(null, args);
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
        deploy: fis.plugin('local-deliver')
      }
    });
  }

  matches.forEach(function(item) {
    var list = find(item);
    var all = total.concat();
    var tasks = item.properties.deploy;

    if (!Array.isArray(tasks)) {
      tasks = [tasks];
    }

    chains.use(function(v, next) {
      var subchains = makeChains();

      tasks.forEach(function(plugin) {
        subchains.use(function(v, next) {
          var ret = callPlugin(plugin, list, all, next);

          // 当有返回值时，表示不是异步，不需要等待。
          if (typeof ret !== 'undefined') {
            next(ret);
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
