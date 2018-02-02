/*global describe, it, after, before */
const crypto = require('crypto');
const Message = require('../cjs/message.js');
const util = require('../cjs/util.js');

describe('Message', function() {
  let msg;
  msg = void 0;
  describe('createRating method', function() {
    beforeAll(function() {
      return msg = Message.createRating({
        author: [['email', 'alice@example.com']],
        recipient: [['email', 'bob@example.com']],
        rating: 5,
        comment: 'Good guy'
      });
    });
    test('should create a message', function() {
      expect(msg).toHaveProperty('signedData.timestamp');
    });
  });
  describe('Validation', function() {
    test('should not accept a message without signedData', function() {
      const f = function() {
        new Message({});
      };
      expect(f).toThrow(Error);
    });
  });
  describe('Message signature', function() {
    let key;
    msg = void 0;
    beforeAll(function() {
      msg = Message.createRating({
        author: [['email', 'alice@example.com']],
        recipient: [['email', 'bob@example.com']],
        rating: 5,
        comment: 'Good guy'
      });
      key = util.generate();
    });
    test('should be signed with sign()', function() {
      msg.sign(key.private.pem, key.public.hex);
      expect(msg).toHaveProperty('jws');
      expect(msg).toHaveProperty('jwsHeader');
      expect(msg).toHaveProperty('hash');
    });
  });
  return describe('fromJws method', function() {
    test('should successfully create a message from jws', function() {
      const newMessage = Message.fromJws(msg.jws);
      expect(newMessage).toHaveProperty('signedData');
    });
  });
});
