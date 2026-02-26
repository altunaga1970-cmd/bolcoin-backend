#!/usr/bin/env node

/**
 * PRE-DEPLOYMENT CHECK INTERACTIVO
 *
 * Verifica el estado del contrato antes de deployar el scheduler
 *
 * Usage:
 *   node scripts/pre-deployment-check.js
 */

const { ethers } = require('hardhat');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║  🔍 PRE-DEPLOYMENT CHECK              ║');
  console.log('╚════════════════════════════════════════╝\n');

  // 1. Pedir contract address
  let bingoAddress = process.env.BINGO_CONTRACT_ADDRESS;

  if (!bingoAddress) {
    bingoAddress = await question('📍 BINGO_CONTRACT_ADDRESS (0x...): ');
    bingoAddress = bingoAddress.trim();
  }

  if (!bingoAddress.startsWith('0x') || bingoAddress.length !== 42) {
    console.log('❌ Invalid address format');
    process.exit(1);
  }

  console.log(`\n✅ Using contract: ${bingoAddress}\n`);

  // 2. Conectar al contrato
  console.log('🔌 Connecting to contract...');

  const BingoGame = await ethers.getContractFactory('BingoGame');
  const bingo = BingoGame.attach(bingoAddress);

  try {
    // Test connection
    const roundCounter = await bingo.roundCounter();
    console.log(`✅ Connected successfully`);
    console.log(`   Total rounds created: ${roundCounter}\n`);
  } catch (err) {
    console.log('❌ Failed to connect to contract');
    console.log(`   Error: ${err.message}`);
    console.log('\n💡 Possible causes:');
    console.log('   - Wrong network (check hardhat.config.js)');
    console.log('   - Wrong contract address');
    console.log('   - RPC not responding\n');
    process.exit(1);
  }

  // 3. Check operator
  console.log('═══ 1. Operator Verification ═══\n');

  const contractOperator = await bingo.operator();
  console.log(`Contract operator: ${contractOperator}`);

  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
  if (operatorKey) {
    const wallet = new ethers.Wallet(operatorKey);
    console.log(`Your wallet:       ${wallet.address}`);

    if (contractOperator.toLowerCase() === wallet.address.toLowerCase()) {
      console.log('✅ Operator match!\n');
    } else {
      console.log('❌ OPERATOR MISMATCH!');
      console.log('   The OPERATOR_PRIVATE_KEY does not match the contract operator');
      console.log('   Fix: Use the correct private key in Railway\n');
    }
  } else {
    console.log('⚠️  OPERATOR_PRIVATE_KEY not set (configure in Railway)\n');
  }

  // 4. Check for orphan rounds
  console.log('═══ 2. Orphan Rounds Check ═══\n');

  const roundCounter = await bingo.roundCounter();
  const orphans = [];

  for (let i = 1; i <= Number(roundCounter); i++) {
    const round = await bingo.rounds(i);
    const status = Number(round.status);

    // Status: 1=OPEN, 2=CLOSED
    if (status === 1 || status === 2) {
      const statusName = status === 1 ? 'OPEN' : 'CLOSED';
      orphans.push({ id: i, status: statusName });
      console.log(`⚠️  Round ${i}: ${statusName}`);
    }
  }

  if (orphans.length === 0) {
    console.log('✅ No orphan rounds found\n');
  } else {
    console.log(`\n❌ Found ${orphans.length} orphan rounds`);
    console.log('\n🔧 Fix:');
    console.log('   npx hardhat run scripts/emergency-cancel-rounds.js --network amoy\n');
  }

  // 5. Check VRF config
  console.log('═══ 3. VRF Configuration ═══\n');

  const vrfSubId = await bingo.vrfSubscriptionId();
  const vrfKeyHash = await bingo.vrfKeyHash();

  console.log(`VRF Subscription ID: ${vrfSubId}`);
  console.log(`VRF Key Hash: ${vrfKeyHash.substring(0, 20)}...`);

  console.log('\n💡 To verify VRF is funded and contract is consumer:');
  console.log('   npx hardhat run scripts/diagnose-vrf-config.js --network amoy\n');

  // 6. Summary
  console.log('═══════════════════════════════════════\n');
  console.log('📋 SUMMARY\n');

  const issues = [];

  if (operatorKey) {
    const wallet = new ethers.Wallet(operatorKey);
    if (contractOperator.toLowerCase() !== wallet.address.toLowerCase()) {
      issues.push('❌ Operator mismatch');
    }
  }

  if (orphans.length > 0) {
    issues.push(`❌ ${orphans.length} orphan rounds`);
  }

  if (issues.length === 0) {
    console.log('✅ ALL CHECKS PASSED\n');
    console.log('Ready to deploy!\n');
    console.log('Next steps:');
    console.log('1. Configure variables in Railway');
    console.log('2. Deploy');
    console.log('3. Monitor logs\n');
  } else {
    console.log('❌ ISSUES FOUND:\n');
    issues.forEach(issue => console.log(`   ${issue}`));
    console.log('\nFix these issues before deploying.\n');
  }

  // 7. Show config for Railway
  console.log('═══════════════════════════════════════\n');
  console.log('📝 RAILWAY CONFIGURATION\n');
  console.log('Add these variables to Railway:\n');
  console.log(`BINGO_CONTRACT_ADDRESS=${bingoAddress}`);
  console.log(`RPC_URL=<your_alchemy_or_infura_url>`);
  console.log(`OPERATOR_PRIVATE_KEY=<private_key_for_${contractOperator}>`);
  console.log(`ENABLE_BINGO_SCHEDULER=true\n`);

  rl.close();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    rl.close();
    process.exit(1);
  });
