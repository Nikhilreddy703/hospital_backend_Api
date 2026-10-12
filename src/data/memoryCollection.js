const { ObjectId } = require('mongodb');

function pathValue(document, path) {
  return path.split('.').reduce((value, key) => value == null ? undefined : value[key], document);
}

function compare(value, operator, expected) {
  if (operator === '$eq') return value === expected || (value == null && expected == null);
  if (operator === '$in') return expected.some((item) => value === item || (value == null && item == null));
  if (operator === '$lte') return value != null && value <= expected;
  if (operator === '$gte') return value != null && value >= expected;
  if (operator === '$lt') return value != null && value < expected;
  if (operator === '$gt') return value != null && value > expected;
  if (operator === '$exists') return (value !== undefined) === expected;
  return false;
}

function matches(document, filter = {}) {
  return Object.entries(filter).every(([path, expected]) => {
    if (path === '$or') return expected.some((clause) => matches(document, clause));
    const value = pathValue(document, path);
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof ObjectId)) {
      return Object.entries(expected).every(([operator, operand]) => operator.startsWith('$')
        ? compare(value, operator, operand)
        : value && value[operator] === operand);
    }
    return value === expected || (value == null && expected == null) ||
      (value && expected && typeof value.equals === 'function' && value.equals(expected));
  });
}

function setPath(document, path, value) {
  const keys = path.split('.');
  let target = document;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  target[keys[keys.length - 1]] = value;
}

function applyUpdate(document, update, inserting = false) {
  if (!Object.keys(update).some((key) => key.startsWith('$'))) {
    Object.assign(document, update);
    return;
  }
  for (const [path, value] of Object.entries(update.$set || {})) setPath(document, path, value);
  if (inserting) for (const [path, value] of Object.entries(update.$setOnInsert || {})) setPath(document, path, value);
  for (const [path, amount] of Object.entries(update.$inc || {})) setPath(document, path, (pathValue(document, path) || 0) + amount);
}

function expression(document, value) {
  if (typeof value === 'string' && value.startsWith('$')) return pathValue(document, value.slice(1));
  if (Array.isArray(value)) return value.map((item) => expression(document, item));
  if (value && typeof value === 'object') {
    if ('$eq' in value) { const [left, right] = expression(document, value.$eq); return left === right; }
    if ('$in' in value) { const [item, list] = expression(document, value.$in); return list.includes(item); }
    if ('$cond' in value) { const [condition, yes, no] = value.$cond; return expression(document, expression(document, condition) ? yes : no); }
  }
  return value;
}

function createMemoryCollection(documents) {
  const cursor = (filter) => {
    let result = documents.filter((document) => matches(document, filter));
    const api = {
      sort(specification) {
        result = [...result].sort((left, right) => {
          for (const [field, direction] of Object.entries(specification)) {
            const a = pathValue(left, field);
            const b = pathValue(right, field);
            if (a < b) return -direction;
            if (a > b) return direction;
          }
          return 0;
        });
        return api;
      },
      skip(amount) { result = result.slice(amount); return api; },
      limit(amount) { result = result.slice(0, amount); return api; },
      async toArray() { return result; },
    };
    return api;
  };

  return {
    find: cursor,
    async findOne(filter) { return documents.find((document) => matches(document, filter)) || null; },
    async countDocuments(filter) { return documents.filter((document) => matches(document, filter)).length; },
    async insertOne(document) {
      const record = { ...document, _id: document._id || new ObjectId() };
      documents.push(record);
      return { insertedId: record._id };
    },
    async updateOne(filter, update, options = {}) {
      let record = documents.find((document) => matches(document, filter));
      if (!record && options.upsert) {
        record = {};
        for (const [path, value] of Object.entries(filter)) if (!path.startsWith('$') && (!value || typeof value !== 'object')) setPath(record, path, value);
        applyUpdate(record, update, true);
        record._id ||= new ObjectId();
        documents.push(record);
        return { matchedCount: 0, modifiedCount: 0, upsertedId: record._id };
      }
      if (!record) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(record, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const record = documents.find((document) => matches(document, filter));
      if (!record) return null;
      applyUpdate(record, update);
      return record;
    },
    async deleteOne(filter) {
      const index = documents.findIndex((document) => matches(document, filter));
      if (index < 0) return { deletedCount: 0 };
      documents.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      const before = documents.length;
      for (let index = documents.length - 1; index >= 0; index -= 1) if (matches(documents[index], filter)) documents.splice(index, 1);
      return { deletedCount: before - documents.length };
    },
    async createIndex() { return 'memory-test-index'; },
    aggregate(pipeline) {
      let result = documents;
      for (const stage of pipeline) {
        if (stage.$match) result = result.filter((document) => matches(document, stage.$match));
        if (stage.$group) {
          const group = {};
          for (const document of result) {
            for (const [field, accumulator] of Object.entries(stage.$group)) {
              if (field === '_id') continue;
              if ('$sum' in accumulator) group[field] = (group[field] || 0) + Number(expression(document, accumulator.$sum));
            }
          }
          result = result.length ? [{ _id: stage.$group._id, ...group }] : [];
        }
      }
      return { async toArray() { return result; } };
    },
  };
}

module.exports = { createMemoryCollection };
