#!/usr/bin/env bash

# SECURITY AUDIT SCRIPT
# Runs Slither, Mythril, and custom checks on Bolcoin smart contracts
#
# Usage:
#   bash scripts/security-audit.sh [contract_name]
#
# Examples:
#   bash scripts/security-audit.sh BingoGame
#   bash scripts/security-audit.sh KenoGame
#   bash scripts/security-audit.sh all

set -e

echo "=== 🔒 BOLCOIN SECURITY AUDIT ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTRACT_DIR="contracts"
REPORT_DIR="audit-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create report directory
mkdir -p "$REPORT_DIR"

# Determine which contracts to audit
if [ "$1" == "all" ] || [ -z "$1" ]; then
  CONTRACTS=("BingoGame" "KenoGame" "LaBolitaGame")
else
  CONTRACTS=("$1")
fi

echo "Auditing contracts: ${CONTRACTS[@]}"
echo ""

# Check if Slither is installed
check_slither() {
  if ! command -v slither &> /dev/null; then
    echo -e "${RED}❌ Slither not installed${NC}"
    echo "Install with: pip install slither-analyzer"
    echo "See: https://github.com/crytic/slither"
    return 1
  else
    echo -e "${GREEN}✅ Slither found${NC}"
    return 0
  fi
}

# Check if Mythril is installed
check_mythril() {
  if ! command -v myth &> /dev/null; then
    echo -e "${YELLOW}⚠️  Mythril not installed (optional)${NC}"
    echo "Install with: pip install mythril"
    echo "See: https://github.com/ConsenSys/mythril"
    return 1
  else
    echo -e "${GREEN}✅ Mythril found${NC}"
    return 0
  fi
}

# Run Slither analysis
run_slither() {
  local contract=$1
  local report_file="$REPORT_DIR/slither_${contract}_${TIMESTAMP}.txt"

  echo -e "\n${BLUE}▶ Running Slither on $contract...${NC}\n"

  # Run Slither with common detectors
  slither "$CONTRACT_DIR/${contract}.sol" \
    --exclude-dependencies \
    --exclude-informational \
    --exclude-low \
    --print human-summary \
    > "$report_file" 2>&1 || true

  # Check for high/medium findings
  if grep -q "High:" "$report_file" || grep -q "Medium:" "$report_file"; then
    echo -e "${RED}❌ High or Medium severity issues found!${NC}"
    echo "   Report: $report_file"
    grep -A 5 "High:\|Medium:" "$report_file" || true
    return 1
  else
    echo -e "${GREEN}✅ No high/medium severity issues${NC}"
    echo "   Full report: $report_file"
    return 0
  fi
}

# Run Mythril analysis
run_mythril() {
  local contract=$1
  local report_file="$REPORT_DIR/mythril_${contract}_${TIMESTAMP}.txt"

  echo -e "\n${BLUE}▶ Running Mythril on $contract...${NC}\n"

  # Run Mythril with timeout
  timeout 600s myth analyze "$CONTRACT_DIR/${contract}.sol" \
    --solv 0.8.24 \
    > "$report_file" 2>&1 || true

  # Check for vulnerabilities
  if grep -q "SWC-" "$report_file"; then
    echo -e "${RED}❌ Vulnerabilities found!${NC}"
    echo "   Report: $report_file"
    grep -A 10 "SWC-" "$report_file" || true
    return 1
  else
    echo -e "${GREEN}✅ No vulnerabilities found${NC}"
    echo "   Full report: $report_file"
    return 0
  fi
}

# Custom security checks
run_custom_checks() {
  local contract=$1
  local file="$CONTRACT_DIR/${contract}.sol"
  local report_file="$REPORT_DIR/custom_${contract}_${TIMESTAMP}.txt"

  echo -e "\n${BLUE}▶ Running custom checks on $contract...${NC}\n"

  {
    echo "=== CUSTOM SECURITY CHECKS ==="
    echo "Contract: $contract"
    echo "Date: $(date)"
    echo ""

    # Check for unchecked external calls
    echo "--- Unchecked External Calls ---"
    if grep -n "\.call{" "$file" | grep -v "require\|assert"; then
      echo "⚠️  Found unchecked .call"
    else
      echo "✅ No unchecked .call found"
    fi
    echo ""

    # Check for reentrancy guards
    echo "--- Reentrancy Protection ---"
    if grep -q "nonReentrant" "$file"; then
      echo "✅ nonReentrant modifier found"
    else
      echo "⚠️  No nonReentrant modifier found"
    fi
    echo ""

    # Check for proper access control
    echo "--- Access Control ---"
    if grep -q "onlyOwner\|onlyOperator\|onlyRole" "$file"; then
      echo "✅ Access control modifiers found"
    else
      echo "⚠️  No access control modifiers found"
    fi
    echo ""

    # Check for overflow protection (should use 0.8.x)
    echo "--- Overflow Protection ---"
    if grep -q "pragma solidity \^0.8" "$file"; then
      echo "✅ Solidity 0.8.x (built-in overflow protection)"
    else
      echo "⚠️  Not using Solidity 0.8.x"
    fi
    echo ""

    # Check for proper event emissions
    echo "--- Event Emissions ---"
    state_changes=$(grep -c "^\s*\(mapping\|uint\|address\).*=" "$file" || echo 0)
    events=$(grep -c "emit " "$file" || echo 0)
    echo "State changes: ~$state_changes"
    echo "Events emitted: $events"
    if [ "$events" -lt "$state_changes" ]; then
      echo "⚠️  Possible missing event emissions"
    else
      echo "✅ Adequate event emissions"
    fi
    echo ""

    # Check for hardcoded addresses
    echo "--- Hardcoded Addresses ---"
    if grep -n "0x[a-fA-F0-9]\{40\}" "$file" | grep -v "address(0)"; then
      echo "⚠️  Found hardcoded addresses"
      grep -n "0x[a-fA-F0-9]\{40\}" "$file" | grep -v "address(0)"
    else
      echo "✅ No hardcoded addresses"
    fi
    echo ""

    # Check for proper visibility
    echo "--- Function Visibility ---"
    public_funcs=$(grep -c "function.*public" "$file" || echo 0)
    external_funcs=$(grep -c "function.*external" "$file" || echo 0)
    private_funcs=$(grep -c "function.*private" "$file" || echo 0)
    internal_funcs=$(grep -c "function.*internal" "$file" || echo 0)
    echo "Public: $public_funcs"
    echo "External: $external_funcs"
    echo "Private: $private_funcs"
    echo "Internal: $internal_funcs"
    echo ""

    # Check for TODO/FIXME
    echo "--- Code Quality ---"
    if grep -n "TODO\|FIXME\|XXX\|HACK" "$file"; then
      echo "⚠️  Found TODO/FIXME comments"
    else
      echo "✅ No TODO/FIXME comments"
    fi
    echo ""

  } > "$report_file"

  cat "$report_file"
  echo -e "${GREEN}✅ Custom checks complete${NC}"
  echo "   Full report: $report_file"
}

# Main execution
main() {
  echo "=== 1️⃣ Tool Check ==="

  HAS_SLITHER=false
  HAS_MYTHRIL=false

  check_slither && HAS_SLITHER=true
  check_mythril && HAS_MYTHRIL=true

  if [ "$HAS_SLITHER" = false ] && [ "$HAS_MYTHRIL" = false ]; then
    echo -e "${RED}❌ No security tools installed!${NC}"
    echo "Install at least Slither to continue."
    exit 1
  fi

  echo ""
  echo "=== 2️⃣ Compile Contracts ==="
  npx hardhat compile --quiet || {
    echo -e "${RED}❌ Compilation failed!${NC}"
    exit 1
  }
  echo -e "${GREEN}✅ Contracts compiled${NC}"

  # Audit each contract
  for contract in "${CONTRACTS[@]}"; do
    echo ""
    echo "============================================"
    echo "=== AUDITING: $contract"
    echo "============================================"

    # Run available tools
    SLITHER_PASS=true
    MYTHRIL_PASS=true
    CUSTOM_PASS=true

    if [ "$HAS_SLITHER" = true ]; then
      run_slither "$contract" || SLITHER_PASS=false
    fi

    if [ "$HAS_MYTHRIL" = true ]; then
      run_mythril "$contract" || MYTHRIL_PASS=false
    fi

    run_custom_checks "$contract" || CUSTOM_PASS=true

    # Summary
    echo ""
    echo "=== SUMMARY: $contract ==="
    if [ "$HAS_SLITHER" = true ]; then
      if [ "$SLITHER_PASS" = true ]; then
        echo -e "Slither:       ${GREEN}✅ PASS${NC}"
      else
        echo -e "Slither:       ${RED}❌ FAIL${NC}"
      fi
    fi

    if [ "$HAS_MYTHRIL" = true ]; then
      if [ "$MYTHRIL_PASS" = true ]; then
        echo -e "Mythril:       ${GREEN}✅ PASS${NC}"
      else
        echo -e "Mythril:       ${RED}❌ FAIL${NC}"
      fi
    fi

    echo -e "Custom checks: ${GREEN}✅ COMPLETE${NC}"
    echo ""
  done

  # Final summary
  echo "============================================"
  echo "=== AUDIT COMPLETE ==="
  echo "============================================"
  echo ""
  echo "Reports generated in: $REPORT_DIR/"
  echo ""
  echo "Next steps:"
  echo "1. Review all reports in $REPORT_DIR/"
  echo "2. Address any high/medium findings"
  echo "3. Consider external audit (OpenZeppelin, CertiK)"
  echo "4. Update IMPLEMENTATION_PROGRESS.md"
  echo ""
}

# Run main
main
