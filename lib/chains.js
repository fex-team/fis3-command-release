var _ = fis.util;

function prevCallbacks(fn, error, value) {
  while (fn) {
    fn.__callback && (fn.__callback(error, value), value = fn.__ret);
    fn = fn.__prev;
  }
}

module.exports = function() {
  var chains = [];

  return {
    use: function(fn) {
      chains.push(fn);
      return this;
    },

    run: function(value) {
      var fn = _.reduceRight(chains, function(next, current) {
        (next.__raw || next).__prev = current;

        var wrapped = function(error, value, callback) {
          if (arguments.length === 2 && typeof value === 'function') {
            callback = value;
            value = null;
          }
          current.__ret = value;
          current.__callback = callback;
          error ? prevCallbacks(current, error, value) : current(value, next);
        };

        wrapped.__raw = current;
        return wrapped;
      }, function(error, ret, callback) {
        var fn = arguments.callee;
        callback && callback(error, ret);
        prevCallbacks(fn, error, ret);
      })(null, value);
    }
  };
};
