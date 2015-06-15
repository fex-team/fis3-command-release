var stream = process.stdout;

function time(fn) {
  stream.write('\n δ '.bold.yellow);
  var now = Date.now();
  fn();
  stream.write((Date.now() - now + 'ms').green.bold);
  stream.write('\n');
}

module.exports = time;
