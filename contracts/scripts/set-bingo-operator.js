const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  const BINGO_ADDRESS = "0x4Aa6f249020e90c09B5A115b6a65FE84F01f014D";
  const NEW_OPERATOR  = "0x5fa4fF772dA22293dd9fa4CEA13caB6b9d3360ff";

  console.log("Updating BingoGame operator...");
  console.log("Caller (owner):", deployer.address);
  console.log("New operator:  ", NEW_OPERATOR);

  const bingo = await ethers.getContractAt("BingoGame", BINGO_ADDRESS);

  const currentOperator = await bingo.operator();
  console.log("\nCurrent operator:", currentOperator);

  if (currentOperator.toLowerCase() === NEW_OPERATOR.toLowerCase()) {
    console.log("✓ Operator already set correctly!");
    return;
  }

  console.log("\nCalling setOperator()...");
  const tx = await bingo.setOperator(NEW_OPERATOR);
  await tx.wait();

  const updated = await bingo.operator();
  console.log("✓ Operator updated to:", updated);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
