// Reusable script to populate the Keno payout table
// Usage: called by deploy scripts or standalone via hardhat task

// Standard Keno payout table (1e2 scaled: 300 = 3.00x)
const PAYOUT_TABLE = {
  1:  [0, 300],
  2:  [0, 100, 900],
  3:  [0, 0, 200, 2700],
  4:  [0, 0, 100, 500, 7500],
  5:  [0, 0, 0, 300, 1200, 30000],
  6:  [0, 0, 0, 200, 500, 5000, 100000],
  7:  [0, 0, 0, 100, 300, 2000, 10000, 200000],
  8:  [0, 0, 0, 0, 200, 1000, 5000, 50000, 500000],
  9:  [0, 0, 0, 0, 100, 500, 2500, 20000, 200000, 750000],
  10: [0, 0, 0, 0, 0, 300, 1500, 10000, 100000, 500000, 1000000],
};

async function setupPayoutTable(keno) {
  console.log("Setting up payout table...");

  for (let spots = 1; spots <= 10; spots++) {
    const mults = PAYOUT_TABLE[spots];
    const tx = await keno.updatePayoutRow(spots, mults);
    await tx.wait();
    console.log(`  Spots ${spots}: ${mults.length} entries written`);
  }

  const commitTx = await keno.commitPayoutUpdate();
  await commitTx.wait();

  const version = await keno.payoutTableVersion();
  console.log(`Payout table committed (version ${version})`);
}

module.exports = { PAYOUT_TABLE, setupPayoutTable };
