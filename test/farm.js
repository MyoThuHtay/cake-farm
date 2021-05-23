/* eslint-disable no-unused-expressions */

const BigNumber = require('bignumber.js')
require('chai').use(require('chai-as-promised')).use(require('chai-bignumber')(BigNumber)).should()

const Farm = artifacts.require('./NepCakeFarm')
const NTransferUtilV1 = artifacts.require('./NTransferUtilV1')
const MaliciousToken = artifacts.require('./MaliciousToken')
const NTransferUtilV1Intermediate = artifacts.require('./NTransferUtilV1Intermediate')
const Destroyable = artifacts.require('./Destroyable')
const FakeToken = artifacts.require('./Token')
const FakeNEPToken = artifacts.require('./Token')
const FakeCAKEToken = artifacts.require('./Token')
const FakeCakeMasterChef = artifacts.require('./FakeCakeMasterChef')
const FakePancakeRouter = artifacts.require('./FakePancakeRouter')
const { advanceByBlocks } = require('./blocks')

const stakes = []
const nepUnitPerCakeUnitPerBlock = BigNumber('3329528158295')
const minimumWithdrawalPeriod = 12
const ZERO_X = '0x0000000000000000000000000000000000000000'
const toWei = x => { return web3.utils.toWei(x.toString()) }
const burnPath = [ZERO_X, ZERO_X]

BigNumber.config({ EXPONENTIAL_AT: 30 })

contract('NEP Cake Farm', function (accounts) {
  const ether = 1000000000000000000
  const million = 1000000
  let TransferLib
  const [owner, alice, bob, mallory] = accounts // eslint-disable-line

  before(async () => {
    TransferLib = await NTransferUtilV1.new()
    await Farm.link('NTransferUtilV1', TransferLib.address)
    await NTransferUtilV1Intermediate.link('NTransferUtilV1', TransferLib.address)
  })

  describe('NTransferUtilV1', () => {
    let intermediate, evil, nonEvil

    beforeEach(async () => {
      const amount = BigNumber(500 * million * ether)
      evil = await MaliciousToken.new()
      nonEvil = await FakeCAKEToken.new('Non Evil', 'NEV', amount)

      intermediate = await NTransferUtilV1Intermediate.new()
      await evil.mint(owner, amount)

      await evil.transfer(intermediate.address, BigNumber(1000 * ether))
      await nonEvil.transfer(intermediate.address, BigNumber(1000 * ether))

      await evil.transfer(alice, BigNumber(1000 * ether))
      await nonEvil.transfer(alice, BigNumber(1000 * ether))
    })

    it('accepts non-malicious transfers', async () => {
      await intermediate.iTransfer(nonEvil.address, alice, BigNumber(100)).should.not.be.rejected
    })

    it('rejects transfer to zero address', async () => {
      await intermediate.iTransfer(nonEvil.address, ZERO_X, BigNumber(1)).should.be.rejectedWith('Invalid recipient')
    })

    it('rejects zero value transfers', async () => {
      await intermediate.iTransfer(nonEvil.address, alice, '0').should.be.rejectedWith('Invalid transfer amount')
    })

    it('rejects malicious transfers', async () => {
      await intermediate.iTransfer(evil.address, alice, BigNumber(100)).should.be.rejectedWith('Invalid transfer')
    })

    it('accepts non-malicious approved transfers', async () => {
      await nonEvil.approve(intermediate.address, BigNumber(100), { from: alice })
      await intermediate.iTransferFrom(nonEvil.address, alice, bob, BigNumber(100), { from: alice }).should.not.be.rejected
    })

    it('rejects zero value approved transfers', async () => {
      await nonEvil.approve(intermediate.address, BigNumber(100), { from: alice })
      await intermediate.iTransferFrom(nonEvil.address, alice, bob, '0', { from: alice }).should.be.rejectedWith('Invalid transfer amount')
    })

    it('rejects approved transfers to zero address', async () => {
      await nonEvil.approve(intermediate.address, BigNumber(100), { from: alice })
      await intermediate.iTransferFrom(nonEvil.address, alice, ZERO_X, BigNumber(100), { from: alice }).should.be.rejectedWith('Invalid recipient')
    })

    it('rejects malicious approved transfers', async () => {
      await evil.approve(intermediate.address, BigNumber(100), { from: alice })
      await intermediate.iTransferFrom(evil.address, alice, bob, BigNumber(100), { from: alice }).should.be.rejectedWith('Invalid transfer')
    })
  })

  describe('Farming', () => {
    let cakeToken, nepToken, farm, cakeMasterChef, router

    before(async () => {
      nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      router = await FakePancakeRouter.new()

      await nepToken.transfer(alice, BigNumber(50 * million * ether))
      await nepToken.transfer(bob, BigNumber(50 * million * ether))
      await nepToken.transfer(mallory, BigNumber(50 * million * ether))

      await cakeToken.transfer(alice, BigNumber(50 * million * ether))
      await cakeToken.transfer(bob, BigNumber(50 * million * ether))
      await cakeToken.transfer(mallory, BigNumber(50 * million * ether))

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
      await farm.setMinStakingPeriodInBlocks(minimumWithdrawalPeriod)
    })

    it('sets the farm properly without any nep token deposit', async () => {
      const maximumCakeForStaking = BigNumber(3 * million * ether)
      await farm.setFarm(nepUnitPerCakeUnitPerBlock, maximumCakeForStaking, 0).should.not.rejected
    })

    it('sets the farm properly without any change in reward', async () => {
      const maximumCakeForStaking = BigNumber(3 * million * ether)
      await farm.setFarm(0, maximumCakeForStaking, 0).should.not.rejected
    })

    it('sets the farm properly without any change in max liquidity', async () => {
      await farm.setFarm(0, 0, 0).should.not.rejected
    })

    it('sets the farm properly', async () => {
      const maximumCakeForStaking = BigNumber(3 * million * ether)
      const amount = BigNumber(10 * million * ether)

      await nepToken.approve(farm.address, amount)
      await farm.setFarm(nepUnitPerCakeUnitPerBlock, maximumCakeForStaking, amount)
    })

    it('rejects zero value deposits', async () => {
      const amount = BigNumber(0)

      await cakeToken.approve(farm.address, amount, { from: alice })
      await farm.deposit(amount, { from: alice }).should.be.rejectedWith('Invalid amount')
    })

    it('enables depositing CAKE', async () => {
      const amount = BigNumber(2000 * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      const tx = await farm.deposit(amount, { from: alice })

      stakes.push({
        account: alice,
        type: 'Deposit',
        block: tx.receipt.blockNumber,
        amount: amount.toNumber(),
        timestamp: new Date()
      })
    })

    it('returns zero for staking rewards when block hasn\'t advanced', async () => {
      const rewards = await farm.calculateRewards(alice)
      rewards.toString().should.equal('0')
    })

    it('rejects deposits when the amount is greater than max limit', async () => {
      const amount = BigNumber(200 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: mallory })
      await farm.deposit(amount, { from: mallory }).should.be.rejected
    })

    it('correctly calculates the staking rewards', async () => {
      await advanceByBlocks(20)

      const { amount: stake } = stakes.find(x => x.account === alice)
      const totalBlocks = await farm.getTotalBlocksSinceLastReward(alice)

      const expected = BigNumber(totalBlocks * nepUnitPerCakeUnitPerBlock.toNumber() * stake / ether)
      const actual = await farm.calculateRewards(alice)
      expected.toString(10).should.equal(actual.toString(10))
    })

    it('correctly increases the balance when deposited', async () => {
      const amount = BigNumber(1234 * ether)
      await cakeToken.approve(farm.address, amount, { from: alice })
      const tx = await farm.deposit(amount, { from: alice })

      const balance = await farm._cakeBalances(alice)

      stakes.push({
        account: alice,
        type: 'Deposit',
        block: tx.receipt.blockNumber,
        amount: amount.toNumber(),
        timestamp: new Date()
      })

      const totalStake = BigNumber(stakes.filter(x => x.account === alice).map(x => x.amount).reduce((a, b) => a + b, 0))

      balance.toString(10).should.equal(totalStake.toString(10))
    })

    it('correctly decreases the balance when withdrawn', async () => {
      await advanceByBlocks(minimumWithdrawalPeriod)

      const amount = BigNumber(976 * ether)
      const tx = await farm.withdraw(amount, { from: alice })

      const balance = await farm._cakeBalances(alice)

      stakes.push({
        account: alice,
        type: 'Withdrawal',
        block: tx.receipt.blockNumber,
        amount: amount.toNumber() * -1,
        timestamp: new Date()
      })

      const totalStake = BigNumber(stakes.filter(x => x.account === alice).map(x => x.amount).reduce((a, b) => a + b, 0))

      balance.toString(10).should.equal(totalStake.toString(10))
    })

    it('rejects zero value withdrawals', async () => {
      await farm.withdraw('0').should.be.rejectedWith('Invalid')
    })

    it('checks if there is sufficient balance to withdraw', async () => {
      await farm.deposit(BigNumber(1), { from: mallory })

      const totalStaked = BigNumber(await farm.getTotalStaked(mallory))
      await farm.withdraw(totalStaked.plus(1), { from: mallory }).should.be.rejectedWith('Try again later')
    })

    it('only allows withdrawals after a set amount of blocks are mined', async () => {
      const totalStaked = BigNumber(await farm.getTotalStaked(mallory))
      await farm.withdraw(totalStaked, { from: mallory }).should.be.rejectedWith('too early')
    })

    it('harvests rewards on deposit', async () => {
      let amount = BigNumber(324 * ether)

      await cakeToken.approve(farm.address, amount, { from: bob })
      let tx = await farm.deposit(amount, { from: bob })

      stakes.push({
        account: bob,
        type: 'Deposit',
        block: tx.receipt.blockNumber,
        amount: amount.toNumber(),
        timestamp: new Date()
      })

      // Need to advance at least a block to harvest the rewards
      await advanceByBlocks(10)
      amount = BigNumber(666 * ether)

      await cakeToken.approve(farm.address, amount, { from: bob })
      tx = await farm.deposit(amount, { from: bob })

      stakes.push({
        account: bob,
        type: 'Deposit',
        block: tx.receipt.blockNumber,
        amount: amount.toNumber(),
        timestamp: new Date()
      })
    })

    it('enables harvesting', async () => {
      // Need to advance at least a block to harvest the rewards
      await advanceByBlocks(50)
      await farm.withdrawRewards({ from: bob }).should.not.be.rejected
    })

    it('updates reward heights during each interaction', async () => {
      // Initial deposit
      let amount = BigNumber(4000 * ether)

      await cakeToken.approve(farm.address, amount, { from: mallory })
      let tx = await farm.deposit(amount, { from: mallory })

      await advanceByBlocks(100)

      let height = tx.receipt.blockNumber
      let rewardHeights = await farm._rewardHeights(mallory)
      BigNumber(rewardHeights).toNumber().should.equal(height)

      // Deposit again
      amount = BigNumber(200 * ether)
      await cakeToken.approve(farm.address, amount, { from: mallory })
      tx = await farm.deposit(amount, { from: mallory })

      height = tx.receipt.blockNumber
      rewardHeights = await farm._rewardHeights(mallory)
      BigNumber(rewardHeights).toNumber().should.equal(height)

      // Harvest
      await advanceByBlocks(43)
      tx = await farm.withdrawRewards({ from: mallory })

      height = tx.receipt.blockNumber
      rewardHeights = await farm._rewardHeights(mallory)
      BigNumber(rewardHeights).toNumber().should.equal(height)

      // Withdraw
      await advanceByBlocks(100 + minimumWithdrawalPeriod)

      amount = BigNumber(900 * ether)
      tx = await farm.withdraw(amount, { from: mallory })

      height = tx.receipt.blockNumber
      rewardHeights = await farm._rewardHeights(mallory)
      BigNumber(rewardHeights).toNumber().should.equal(height)

      // Harvest again
      await advanceByBlocks(60)
      tx = await farm.withdrawRewards({ from: mallory })

      height = tx.receipt.blockNumber
      rewardHeights = await farm._rewardHeights(mallory)
      BigNumber(rewardHeights).toNumber().should.equal(height)
    })

    it('commits liquidity during harvests', async () => {
      await cakeToken.transfer(farm.address, BigNumber(1 * ether))
      await advanceByBlocks(60)
      await farm.withdrawRewards({ from: mallory })
    })
  })

  describe('Calculations', () => {
    let cakeToken, nepToken, farm, cakeMasterChef, router

    beforeEach(async () => {
      nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      router = await FakePancakeRouter.new()

      await nepToken.transfer(alice, BigNumber(50 * million * ether))
      await nepToken.transfer(bob, BigNumber(50 * million * ether))
      await nepToken.transfer(mallory, BigNumber(50 * million * ether))

      await cakeToken.transfer(alice, BigNumber(50 * million * ether))
      await cakeToken.transfer(bob, BigNumber(50 * million * ether))
      await cakeToken.transfer(mallory, BigNumber(50 * million * ether))

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
      await farm.setMinStakingPeriodInBlocks(minimumWithdrawalPeriod)

      const maximumCakeForStaking = BigNumber(3 * million * ether)
      const amount = BigNumber(10 * million * ether)

      await nepToken.approve(farm.address, amount)
      await farm.setFarm(nepUnitPerCakeUnitPerBlock, maximumCakeForStaking, amount)
    })

    it('produces summary info', async () => {
      const info = await farm.getInfo(owner)
      const [rewards, staked, nepPerTokenPerBlock, totalTokensLocked, totalNepLocked, maxToStake] = info

      rewards.should.bignumber
      staked.should.bignumber
      nepPerTokenPerBlock.should.bignumber
      totalTokensLocked.should.bignumber
      totalNepLocked.should.bignumber
      maxToStake.should.bignumber
    })

    it('accurately returns remaining amount that can be staked', async () => {
      let remainingToStake = await farm.getRemainingToStake()
      remainingToStake.toString().should.equal(BigNumber(3 * million * ether).toString())

      let amount = BigNumber(2 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      await farm.deposit(amount, { from: alice })

      remainingToStake = await farm.getRemainingToStake()
      remainingToStake.toString().should.equal(BigNumber(1 * million * ether).toString())

      amount = BigNumber(1 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      await farm.deposit(amount, { from: alice })

      remainingToStake = await farm.getRemainingToStake()
      remainingToStake.toString().should.equal('0')
    })

    it('accurately returns total NEP tokens locked', async () => {
      const totalLocked = await farm.getTotalNEPLocked()
      totalLocked.toString().should.equal(BigNumber(10 * million * ether).toString())
    })

    it('accurately returns total staked tokens of an account', async () => {
      let amount = BigNumber(1.2 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      await farm.deposit(amount, { from: alice })

      amount = BigNumber(1.2 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      await farm.deposit(amount, { from: alice })

      const staked = await farm.getTotalStaked(alice)
      staked.toString().should.equal(BigNumber(2.4 * million * ether).toString())
    })

    it('accurately returns withdrawal heights of an account', async () => {
      let amount = BigNumber(0.2 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      let deposit = await farm.deposit(amount, { from: alice })

      let from = await farm.canWithdrawFrom(alice)

      from.toString().should.equal(BigNumber(deposit.receipt.blockNumber + minimumWithdrawalPeriod).toString())

      amount = BigNumber(0.2 * million * ether)

      await cakeToken.approve(farm.address, amount, { from: alice })
      deposit = await farm.deposit(amount, { from: alice })

      from = await farm.canWithdrawFrom(alice)
      from.toString().should.equal(BigNumber(deposit.receipt.blockNumber + minimumWithdrawalPeriod).toString())
    })
  })

  describe('Owner features', () => {
    let cakeToken, nepToken, farm, cakeMasterChef, router

    before(async () => {
      nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      router = await FakePancakeRouter.new()

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
      await farm.setMinStakingPeriodInBlocks(minimumWithdrawalPeriod)
    })
  })

  describe('Recoverable', () => {
    let farm

    before(async () => {
      const nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      const cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      const cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      const router = await FakePancakeRouter.new()

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
      await farm.setMinStakingPeriodInBlocks(minimumWithdrawalPeriod)
    })

    it('allows recovering accidental BNB transfers', async () => {
      const destroyable = await Destroyable.new({
        value: toWei(10)
      })

      await destroyable.destroy(farm.address)
      let balance = await web3.eth.getBalance(farm.address)
      balance.toString().should.equal(toWei(10))

      await farm.recoverEther()

      balance = await web3.eth.getBalance(farm.address)
      balance.toString().should.equal('0')
    })

    it('allows recovering accidental token transfers', async () => {
      const fakeToken = await FakeToken.new('Fake', 'Fake', toWei(1000000))
      fakeToken.transfer(farm.address, toWei(100))

      let balance = await fakeToken.balanceOf(farm.address)
      balance.toString().should.equal(toWei(100))

      await farm.recoverToken(fakeToken.address)

      balance = await fakeToken.balanceOf(farm.address)
      balance.toString().should.equal('0')
    })
  })

  describe('Pausable', () => {
    let farm

    before(async () => {
      const nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      const cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      const cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      const router = await FakePancakeRouter.new()

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
    })

    it('allows pausing the contract', async () => {
      await farm.pause().should.not.be.rejected
      await farm.pause().should.be.rejected
    })

    it('allows unpausing the contract', async () => {
      await farm.unpause().should.not.be.rejected
      await farm.unpause().should.be.rejected
    })
  })

  describe('Burner', () => {
    let farm

    before(async () => {
      const nepToken = await FakeNEPToken.new('Fake NEP', 'NEP', BigNumber(500 * million * ether))
      const cakeToken = await FakeCAKEToken.new('Fake CAKE', 'CAKE', BigNumber(500 * million * ether))
      const cakeMasterChef = await FakeCakeMasterChef.new(cakeToken.address)
      const router = await FakePancakeRouter.new()

      farm = await Farm.new(nepToken.address, cakeToken.address, cakeMasterChef.address, 1, router.address, burnPath)
    })

    it('allows changing the burn path', async () => {
      await farm.updateBurnPath(burnPath).should.not.be.rejected
    })
  })
})
