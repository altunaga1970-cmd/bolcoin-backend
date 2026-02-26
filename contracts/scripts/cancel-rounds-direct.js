const { ethers } = require('hardhat');

const RoundStatus = {
  OPEN: 1,
  CLOSED: 2
};

async function main() {
  const bingoAddress = process.env.BINGO_CONTRACT_ADDRESS || '0x4Aa6f249020e90c09B5A115b6a65FE84F01f014D';
  const operatorKey = process.env.OPERATOR_PRIVATE_KEY;

  if (!operatorKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not set');
  }

  console.log('=== 🚨 EMERGENCY: Cancel Orphan Rounds ===\n');

  // Create wallet from private key
  const provider = ethers.provider;
  const wallet = new ethers.Wallet(operatorKey, provider);

  console.log(`Operator wallet: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MATIC\n`);

  // Connect to contract
  const BingoGame = await ethers.getContractFactory('BingoGame');
  const bingo = BingoGame.attach(bingoAddress).connect(wallet);

  console.log(`Contract: ${bingoAddress}`);

  // Verify operator
  const contractOperator = await bingo.operator();
  console.log(`Contract operator: ${contractOperator}`);

  if (contractOperator.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Operator mismatch! Expected ${contractOperator}, got ${wallet.address}`);
  }

  console.log('✅ Operator verified\n');

  // Find orphan rounds
  const roundCounter = await bingo.roundCounter();
  const orphans = [];

  console.log('Scanning for orphan rounds...\n');

  for (let i = 1; i <= Number(roundCounter); i++) {
    const round = await bingo.rounds(i);
    const status = Number(round.status);

    if (status === RoundStatus.OPEN || status === RoundStatus.CLOSED) {
      const statusName = status === RoundStatus.OPEN ? 'OPEN' : 'CLOSED';
      orphans.push({ id: i, status: statusName });
      console.log(`⚠️  Round ${i}: ${statusName}`);
    }
  }

  if (orphans.length === 0) {
    console.log('\n✅ No orphan rounds found!');
    return;
  }

  console.log(`\nFound ${orphans.length} orphan rounds`);
  console.log('\nCancelling...\n');

  // Cancel each round
  for (const orphan of orphans) {
    console.log(`Cancelling round ${orphan.id}...`);

    try {
      const tx = await bingo.cancelRound(orphan.id);
      console.log(`  TX: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`  ✅ Cancelled in block ${receipt.blockNumber}\n`);
    } catch (err) {
      console.error(`  ❌ Failed: ${err.message}\n`);
    }
  }

  console.log('=== DONE ===\n');
  console.log('Verifying cleanup...\n');

  // Verify
  let remaining = 0;
  for (let i = 1; i <= Number(roundCounter); i++) {
    const round = await bingo.rounds(i);
    const status = Number(round.status);

    if (status === RoundStatus.OPEN || status === RoundStatus.CLOSED) {
      remaining++;
    }
  }

  if (remaining === 0) {
    console.log('✅ SUCCESS! All orphan rounds cancelled');
    console.log('   Scheduler can now create new rounds\n');
  } else {
    console.log(`⚠️  ${remaining} rounds still in OPEN/CLOSED state\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  });
