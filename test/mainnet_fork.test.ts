import chai from "chai";
import { expect } from "chai";
import { ethers } from "hardhat";

import { IAlgebraFactory, IAlgebraPool, AlgebraVault, AlgebraVaultFactory, ISwapRouter, TestERC20, UV3Math } from "../types";

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

describe("Vaults on Mainnet Fork", () => {
  let factory: IAlgebraFactory;
  let algebraPool: IAlgebraPool;

  const wbnbAddress = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";
  const frxethAddress = "0x64048A7eEcF3a2F1BA9e144aAc3D7dB6e58F555e";

  const algebraFactory = "0x306F06C147f064A010530292A1EB6737c3e378e4";

  const whaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
  const usdtWhaleAddress = "0xD183F2BBF8b28d9fec8367cb06FE72B88778C86B";
  const wbnbWhaleAddress = "0xF977814e90dA44bFA03b6295A0616a897441aceC";
  const frxethWhaleAddress = "0x2F91dE7942B7CFFaEceB945E803905fBb964f381";

  const affiliateAddress = "0xEa2627556F0df405628783d31e441264C23eBe43";

  const routerAddress = "0x327Dd3208f0bCF590A66110aCB6e5e6941A4EfA0";

  let algebraVaultFactory: AlgebraVaultFactory;
  let usdtWbnbVault: AlgebraVault;
  let wbnbFrxethVault: AlgebraVault;
  let uV3Math: UV3Math;
  let wbnb: TestERC20;
  let usdt: TestERC20;
  let frxeth: TestERC20;

  before("deploy contracts", async () => {
    const [owner] = await ethers.getSigners();

    const uV3MathFactory = await ethers.getContractFactory("UV3Math");
    uV3Math = (await uV3MathFactory.deploy()) as UV3Math;

    const algebraVaultDeployer = await ethers.getContractFactory("AlgebraVaultDeployer", {
      libraries: {
        UV3Math: uV3Math.address,
      },
    });
    const libAlgebraVaultDeployer = await algebraVaultDeployer.deploy();

    const algebraVaultFactoryFactory = await ethers.getContractFactory("AlgebraVaultFactory", {
      libraries: {
        AlgebraVaultDeployer: libAlgebraVaultDeployer.address,
      },
    });

    algebraVaultFactory = (await algebraVaultFactoryFactory.deploy(algebraFactory)) as AlgebraVaultFactory;

    factory = (await ethers.getContractAt("AlgebraFactory", algebraFactory)) as IAlgebraFactory;

    // let [owner, alice] = await ethers.getSigners()

    await algebraVaultFactory.createAlgebraVault(usdtAddress, false, wbnbAddress, true);
    await algebraVaultFactory.createAlgebraVault(wbnbAddress, true, frxethAddress, false);

    const vaultUsdtWbnb = await algebraVaultFactory.genKey(owner.address, usdtAddress, wbnbAddress, false, true);
    // wbnb is token1 in wbnbFrxeth vault
    const vaultWbnbFrxeth = await algebraVaultFactory.genKey(owner.address, wbnbAddress, frxethAddress, true, false);
    const usdtWbnbVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultUsdtWbnb);
    const wbnbFrxethVaultAddress = await algebraVaultFactory.getAlgebraVault(vaultWbnbFrxeth);

    usdtWbnbVault = (await ethers.getContractAt("AlgebraVault", usdtWbnbVaultAddress)) as AlgebraVault;
    wbnbFrxethVault = (await ethers.getContractAt("AlgebraVault", wbnbFrxethVaultAddress)) as AlgebraVault;

    await usdtWbnbVault.setAffiliate(affiliateAddress);
    await usdtWbnbVault.setDepositMax(ethers.utils.parseEther("100000"), ethers.utils.parseEther("100000"));
    await wbnbFrxethVault.setAffiliate(affiliateAddress);

    const poolAddress = await factory.poolByPair(usdtAddress, wbnbAddress);
    algebraPool = (await ethers.getContractAt("IAlgebraPool", poolAddress)) as IAlgebraPool;

    wbnb = (await ethers.getContractAt("TestERC20", wbnbAddress)) as TestERC20;
    usdt = (await ethers.getContractAt("TestERC20", usdtAddress)) as TestERC20;
    frxeth = (await ethers.getContractAt("TestERC20", frxethAddress)) as TestERC20;
  });

  it("allows to operate with usdt-wbnb vault", async () => {
    await ethers.provider.send("hardhat_impersonateAccount", [whaleAddress]);
    const whale = await ethers.provider.getSigner(wbnbWhaleAddress);

    const [owner] = await ethers.getSigners();

    // sanity check usdt-wbnb pool address
    const usdtWbnbMainnetPool = "0xD405b976Ac01023c9064024880999fC450A8668b";
    expect(algebraPool.address).to.equal(usdtWbnbMainnetPool);

    await usdt.connect(whale).approve(usdtWbnbVault.address, ethers.utils.parseEther("1000000"));
    await wbnb.connect(whale).approve(usdtWbnbVault.address, ethers.utils.parseEther("1000000"));

    const usdtBalance = await usdt.connect(whale).balanceOf(wbnbWhaleAddress);
    const wbnbBalance = await wbnb.connect(whale).balanceOf(wbnbWhaleAddress);
    //console.log("usdt: " + usdtBalance.toString() + " wbnb: " + wbnbBalance.toString())

    await usdtWbnbVault.connect(whale).deposit(0, 1000, owner.address);
    // current tick -54063
    await usdtWbnbVault.rebalance(-90000, -63000, -30000, 0, 0);

    const balance0 = await wbnb.balanceOf(usdtWbnbVault.address);
    expect(balance0).to.be.lt(10);
  });

  it("allows to operate with wbnb-frxeth vault", async () => {
    await ethers.provider.send("hardhat_impersonateAccount", [wbnbWhaleAddress]);
    const bnbWhale = await ethers.provider.getSigner(wbnbWhaleAddress);

    const [owner] = await ethers.getSigners();

    await wbnb.connect(bnbWhale).approve(wbnbFrxethVault.address, ethers.utils.parseEther("1000000"));
    //console.log(ethers.utils.parseEther('10'))

    await wbnbFrxethVault.connect(bnbWhale).deposit(0, ethers.utils.parseEther("10"), owner.address);
    let currentTick = await wbnbFrxethVault.currentTick();
    // console.log("current tick = " + currentTick.toString())
    // current tick is in the middle
    await wbnbFrxethVault.rebalance(18000, 20100, 24000, 30000, 0);

    const router = (await ethers.getContractAt("SwapRouter", routerAddress)) as ISwapRouter;

    await ethers.provider.send("hardhat_impersonateAccount", [frxethWhaleAddress]);
    const frxethWhale = await ethers.provider.getSigner(frxethWhaleAddress);

    let balanceWBNB = await wbnb.balanceOf(frxethWhaleAddress);
    //console.log(balanceWBNB.toString())
    const balanceFrxeth = await frxeth.balanceOf(frxethWhaleAddress);
    //console.log(balanceFrxeth.toString())

    await frxeth.connect(frxethWhale).approve(router.address, ethers.utils.parseEther("1000000"));
    await wbnb.connect(frxethWhale).approve(router.address, ethers.utils.parseEther("1000000"));
    await router.connect(frxethWhale).exactInputSingle({
      tokenIn: frxeth.address,
      tokenOut: wbnb.address,
      recipient: frxethWhaleAddress,
      deadline: 2000000000, // Wed May 18 2033 03:33:20 GMT+0000
      amountIn: ethers.utils.parseEther("4"),
      amountOutMinimum: ethers.utils.parseEther("0"),
      limitSqrtPrice: 0,
    });

    currentTick = await wbnbFrxethVault.currentTick();
    //console.log("current tick after trade = " + currentTick.toString())

    balanceWBNB = await wbnb.balanceOf(frxethWhaleAddress);
    //console.log(balanceWBNB.toString())

    let balance0 = await wbnb.balanceOf(wbnbFrxethVault.address);
    expect(balance0).to.be.lt(10);

    let balanceLP = await wbnbFrxethVault.balanceOf(owner.address);
    expect(balanceLP).to.be.gt(0);

    let balanceAff_wbnb = await wbnb.balanceOf(affiliateAddress);
    //console.log(balanceAff_wbnb.toString())
    let balanceAff_frxeth = await frxeth.balanceOf(affiliateAddress);
    //console.log(balanceAff_frxeth.toString())

    await wbnbFrxethVault.rebalance(18000, 20100, 24000, 30000, 0);

    balanceAff_wbnb = await wbnb.balanceOf(affiliateAddress);
    //console.log(balanceAff_wbnb.toString())
    balanceAff_frxeth = await frxeth.balanceOf(affiliateAddress);
    //console.log(balanceAff_frxeth.toString())
    expect(balanceAff_frxeth).to.be.gt(0);

    await wbnbFrxethVault.withdraw(balanceLP.toString(), owner.address);
    balanceLP = await wbnbFrxethVault.balanceOf(owner.address);
    expect(balanceLP).to.be.equal(0);
    balance0 = await wbnb.balanceOf(owner.address);
    expect(balance0).to.be.gt(0);
    //console.log(balance0.toString())
  });
});
