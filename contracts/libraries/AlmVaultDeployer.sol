// SPDX-License-Identifier: BUSL-1.1
pragma solidity >=0.8.4;

import {AlmVault} from '../AlmVault.sol';
import {IAlgebraFactory} from '@cryptoalgebra/integral-core/contracts/interfaces/IAlgebraFactory.sol';

library AlmVaultDeployer {

    function createAlmVault(
        address pluginFactory,
        address pool, 
        address token0,
        bool allowToken0,
        address token1,
        bool allowToken1,
        uint32 twapPeriod,
        uint256 vaultIndex
    ) internal returns(address almVault) {

        almVault = address(
            new AlmVault{salt: keccak256(abi.encodePacked(
                msg.sender, 
                token0, 
                allowToken0, 
                token1, 
                allowToken1)
            )}
                (pluginFactory,
                pool, 
                allowToken0, 
                allowToken1, 
                msg.sender, 
                twapPeriod,
                vaultIndex)
        );
    }
}
