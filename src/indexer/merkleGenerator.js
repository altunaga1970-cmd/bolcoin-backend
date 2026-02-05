const { ethers } = require('ethers');

// =================================
// GENERADOR DE MERKLE TREES
// =================================

/**
 * Clase para generar y manejar Merkle Trees
 * Usado para verificar claims de premios de La Fortuna
 */
class MerkleTree {
    constructor(leaves) {
        this.leaves = leaves.map(leaf => this.hashLeaf(leaf));
        this.layers = this.buildTree(this.leaves);
        this.root = this.layers[this.layers.length - 1][0] || ethers.ZeroHash;
    }

    /**
     * Hash de una hoja (datos del ganador)
     */
    hashLeaf(data) {
        if (typeof data === 'string' && data.startsWith('0x')) {
            return data; // Ya es un hash
        }

        // Codificar datos del ganador
        const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address', 'uint256', 'uint256', 'uint256'],
            [data.address, data.drawId, data.category, data.amount]
        );

        return ethers.keccak256(encoded);
    }

    /**
     * Construir árbol desde las hojas
     */
    buildTree(leaves) {
        if (leaves.length === 0) {
            return [[ethers.ZeroHash]];
        }

        const layers = [leaves];
        let currentLayer = leaves;

        while (currentLayer.length > 1) {
            const nextLayer = [];

            for (let i = 0; i < currentLayer.length; i += 2) {
                const left = currentLayer[i];
                const right = currentLayer[i + 1] || left; // Duplicar si es impar

                // Ordenar para consistencia
                const [first, second] = left < right ? [left, right] : [right, left];
                const combined = ethers.solidityPackedKeccak256(
                    ['bytes32', 'bytes32'],
                    [first, second]
                );

                nextLayer.push(combined);
            }

            layers.push(nextLayer);
            currentLayer = nextLayer;
        }

        return layers;
    }

    /**
     * Obtener root del árbol
     */
    getRoot() {
        return this.root;
    }

    /**
     * Obtener proof para una hoja
     */
    getProof(leafData) {
        const leafHash = this.hashLeaf(leafData);
        let index = this.leaves.indexOf(leafHash);

        if (index === -1) {
            return null; // Hoja no encontrada
        }

        const proof = [];

        for (let i = 0; i < this.layers.length - 1; i++) {
            const layer = this.layers[i];
            const isRight = index % 2 === 1;
            const pairIndex = isRight ? index - 1 : index + 1;

            if (pairIndex < layer.length) {
                proof.push({
                    hash: layer[pairIndex],
                    position: isRight ? 'left' : 'right'
                });
            }

            index = Math.floor(index / 2);
        }

        return proof;
    }

    /**
     * Verificar proof
     */
    static verify(leafHash, proof, root) {
        let computedHash = leafHash;

        for (const { hash, position } of proof) {
            const [first, second] = position === 'left'
                ? [hash, computedHash]
                : [computedHash, hash];

            // Ordenar para consistencia
            const [a, b] = first < second ? [first, second] : [second, first];
            computedHash = ethers.solidityPackedKeccak256(
                ['bytes32', 'bytes32'],
                [a, b]
            );
        }

        return computedHash === root;
    }

    /**
     * Exportar árbol completo (para almacenar)
     */
    toJSON() {
        return {
            root: this.root,
            leaves: this.leaves,
            layers: this.layers
        };
    }

    /**
     * Crear desde JSON exportado
     */
    static fromJSON(json) {
        const tree = Object.create(MerkleTree.prototype);
        tree.root = json.root;
        tree.leaves = json.leaves;
        tree.layers = json.layers;
        return tree;
    }
}

/**
 * Generar Merkle tree para ganadores de un sorteo
 */
function generateWinnersMerkleTree(winners) {
    const leaves = winners.map(winner => ({
        address: winner.user_address,
        drawId: winner.draw_id,
        category: winner.category,
        amount: ethers.parseUnits(winner.prize_amount.toString(), 6) // USDT tiene 6 decimales
    }));

    const tree = new MerkleTree(leaves);

    return {
        tree,
        root: tree.getRoot(),
        proofs: winners.map((winner, index) => ({
            ...winner,
            leafHash: tree.leaves[index],
            proof: tree.getProof(leaves[index])
        }))
    };
}

/**
 * Crear leaf hash para un ganador (para verificación on-chain)
 */
function createLeafHash(address, drawId, category, amount) {
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ['address', 'uint256', 'uint256', 'uint256'],
        [address, drawId, category, amount]
    );
    return ethers.keccak256(encoded);
}

/**
 * Convertir proof a formato para contrato
 */
function proofToBytes32Array(proof) {
    return proof.map(p => p.hash);
}

module.exports = {
    MerkleTree,
    generateWinnersMerkleTree,
    createLeafHash,
    proofToBytes32Array
};
