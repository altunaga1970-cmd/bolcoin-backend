/**
 * Create multiple open draws on LaBolitaGame
 * Usage: npx hardhat run scripts/create-bolita-draws.js --network localhost
 */
const { ethers } = require("hardhat");

const BOLITA_ADDRESS = process.env.BOLITA_ADDRESS || "0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d";

async function main() {
  const [owner] = await ethers.getSigners();
  const bolita = await ethers.getContractAt("LaBolitaGame", BOLITA_ADDRESS);

  const now = Math.floor(Date.now() / 1000);

  const drawsToCreate = [
    { name: "BOLITA-AM", time: now + 3600 },      // 1h from now (morning)
    { name: "BOLITA-PM", time: now + 7200 },      // 2h from now (afternoon)
    { name: "BOLITA-NOCHE", time: now + 14400 },  // 4h from now (evening)
  ];

  for (const d of drawsToCreate) {
    const tx = await bolita.createDraw(d.name, d.time);
    const receipt = await tx.wait();

    let drawId;
    for (const log of receipt.logs) {
      try {
        const parsed = bolita.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "DrawCreated") {
          drawId = parsed.args.drawId;
          break;
        }
      } catch (_) {}
    }

    await bolita.openDraw(drawId);
    console.log(`Draw #${drawId} "${d.name}" created and opened (${new Date(d.time * 1000).toISOString()})`);
  }

  const total = await bolita.drawCounter();
  console.log(`\nTotal draws: ${total}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
