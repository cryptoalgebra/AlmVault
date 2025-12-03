// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.4;

import { AlgebraVaultStable } from "../AlgebraVaultStable.sol";

library AlgebraVaultStableDeployer {
    function createAlgebraVault(
        address pool,
        uint32 twapPeriod,
        uint256 vaultIndex
    ) public returns (address algebraVault) {
        algebraVault = address(
            new AlgebraVaultStable{ salt: keccak256(abi.encodePacked(msg.sender, pool)) }(
                pool,
                twapPeriod,
                vaultIndex
            )
        );
    }
}
