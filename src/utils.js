const VError = require('verror');

function isNumeric(n) {
  // eslint-disable-next-line
  return !isNaN(parseFloat(n)) && isFinite(n);
}

/**
 * @func conditionMustBeSet
 * @param {Object} - conditions
 * @param {String} - condition
 * @returns {Boolean}
 * @description The condition is present and contains the value.
 * Если отсутствует условие или оно не задано
 */
function conditionMustBeSet(conditions, condition) {
  const hasProperty = Object.prototype.hasOwnProperty.call(
    conditions,
    condition,
  );
  const hasValue = hasProperty ? conditions[condition] : false;
  if (!hasProperty || !hasValue) {
    /* Bad request */
    throw new VError(
      {
        info: {
          condition,
          status: 400,
        },
      },
      `WrongMustCondition:${condition}`,
    );
  }

  return true;
}

/**
 * @func conditionMustSet
 * @param {Object} - conditions
 * @param {String} - condition
 * @returns {Boolean}
 * @description The condition is present but doesn't contains the value.
 * Если присутствует условие, но оно не задано
 */
function conditionMustSet(conditions, condition) {
  const hasProperty = Object.prototype.hasOwnProperty.call(
    conditions,
    condition,
  );
  const hasValue = hasProperty ? conditions[condition] : false;
  if (hasProperty && hasValue === false) {
    /* Bad request */
    throw new VError(
      {
        info: {
          condition,
          status: 400,
        },
      },
      `WrongCondition:${condition}`,
    );
  }

  return hasProperty;
}

module.exports = {
  isNumeric,
  conditionMustSet,
  conditionMustBeSet,
};
