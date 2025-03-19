// SPDX-License-Identifier: BUSL-1.1

pragma solidity >=0.8.4;

import {Enum} from "../common/Enum.sol";

interface IGnosisSafe {
    function execTransactionFromModule(address to, uint256 value, bytes memory data, Enum.Operation operation) external returns (bool success);
}