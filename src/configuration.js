'use strict';

const { defaults } = require('./policy');

function readMachinePolicy(configuration) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = configuration.inspect(key)?.globalValue;
    return [key, value === undefined ? fallback : value];
  }));
}

module.exports = { readMachinePolicy };
