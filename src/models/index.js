// =================================
// EXPORTACIÓN CENTRALIZADA DE MODELOS
// =================================

const User = require('./User');
const Transaction = require('./Transaction');
const Draw = require('./Draw');
const Bet = require('./Bet');

module.exports = {
    User,
    Transaction,
    Draw,
    Bet
};
