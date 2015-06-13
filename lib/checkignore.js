var _ = fis.util;
var inited = false;
var ignored = null;
function init() {
  if (inited) {
    return;
  }

  inited = true;
  ignored = fis.media().get('project.ignore', []);

  if (!ignored) {
    ignored = [];
  } else if (!Array.isArray(ignored)) {
    ignored = [ignored];
  }

  ignored = ignored.map(function(pattern) {
    if (pattern[0] !== '/') {
      pattern = '/' + pattern;
    }

    var gReg = null
    if (pattern.slice(-3) === '/**') {
      var gpattern = pattern.replace(/(\/\*\*)+$/, '')
      gReg = _.glob(gpattern);
    }

    return {
      reg: _.glob(pattern),
      gReg: gReg
    };
  });
};

module.exports = function(path) {
  init();

  var hited = false;

  ignored.every(function(item) {

    if (item.reg.test(path) || item.gReg && item.gReg.test(path)) {
      hited = true;
      return false;
    }

    return true;
  });

  // console.log(path, hited);

  return hited;
};
