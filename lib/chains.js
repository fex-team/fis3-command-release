var _ = fis.util;

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

        var wrapped = function(value, callback) {
          current.__ret = value;
          current.__callback = callback;
          current(value, next);
        };

        wrapped.__raw = current;
        return wrapped;
      }, function(ret, callback) {
        var fn = arguments.callee;
        callback && callback();
        while (fn) {
          fn.__callback && (fn.__callback(ret), ret = fn.__ret);
          fn = fn.__prev;
        }
      }).bind(null, value);
      setTimeout(fn);
    }
  };
};
