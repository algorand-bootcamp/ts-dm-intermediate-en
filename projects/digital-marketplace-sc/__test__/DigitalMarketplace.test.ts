import { describe, test, expect, beforeAll, beforeEach } from '@jest/globals';
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing';
import * as algokit from '@algorandfoundation/algokit-utils';
import {
  algos,
  getAccountAddressAsUint8Array,
  getOrCreateKmdWalletAccount,
  microAlgos,
} from '@algorandfoundation/algokit-utils';
import { decodeUint64, encodeUint64 } from 'algosdk';
import { DigitalMarketplaceClient } from '../contracts/clients/DigitalMarketplaceClient';

const fixture = algorandFixture();
algokit.Config.configure({ populateAppCallResources: true });

let appClient: DigitalMarketplaceClient;

const forSaleMbr = 2_500 + 400 * 112;

describe('DigitalMarketplace', () => {
  beforeEach(fixture.beforeEach);

  let testAssetsId: [number | bigint, number | bigint];

  beforeAll(async () => {
    await fixture.beforeEach();
    const { testAccount } = fixture.context;
    const { algorand } = fixture;
    await getOrCreateKmdWalletAccount(
      { name: 'stableSeller', fundWith: algos(100) },
      algorand.client.algod,
      algorand.client.kmd
    );
    await getOrCreateKmdWalletAccount(
      { name: 'buyer', fundWith: algos(100) },
      algorand.client.algod,
      algorand.client.kmd
    );
    const stableSeller = await algorand.account.fromKmd('stableSeller');

    testAssetsId = await Promise.all([
      (
        await algorand.send.assetCreate({
          sender: stableSeller.addr,
          total: BigInt(10_000),
          decimals: 3,
        })
      ).confirmation.assetIndex!,
      (
        await algorand.send.assetCreate({
          sender: stableSeller.addr,
          total: BigInt(10_000),
          decimals: 3,
        })
      ).confirmation.assetIndex!,
    ]);

    appClient = new DigitalMarketplaceClient(
      {
        sender: testAccount,
        resolveBy: 'id',
        id: 0,
      },
      algorand.client.algod
    );

    await appClient.create.createApplication({});
    await appClient.appClient.fundAppAccount(algos(0.1));
  });

  test('allowAsset', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');
    const { appAddress } = await appClient.appClient.getAppReference();

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(appAddress, asset)).rejects.toBeDefined();
      })
    );

    const results = await Promise.all(
      testAssetsId.map(async (asset) =>
        appClient.allowAsset(
          {
            mbrPay: await algorand.transactions.payment({
              sender: stableSeller.addr,
              receiver: appAddress,
              amount: algos(0.1),
              extraFee: microAlgos(1_000),
            }),
            asset,
          },
          { sender: stableSeller }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(appAddress, asset)).resolves.toEqual(
          expect.objectContaining({
            assetId: BigInt(asset),
            balance: BigInt(0),
          })
        );
      })
    );
  });

  test('firstDeposit', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');
    const { appAddress } = await appClient.appClient.getAppReference();

    const results = await Promise.all(
      testAssetsId.map(async (asset) =>
        appClient.firstDeposit(
          {
            mbrPay: await algorand.transactions.payment({
              sender: stableSeller.addr,
              receiver: appAddress,
              amount: microAlgos(forSaleMbr),
            }),
            xfer: await algorand.transactions.assetTransfer({
              assetId: BigInt(asset),
              sender: stableSeller.addr,
              receiver: appAddress,
              amount: BigInt(3_000),
            }),
            nonce: 0,
            unitaryPrice: algos(1).microAlgos,
          },
          { sender: stableSeller }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(appAddress, asset)).resolves.toEqual(
          expect.objectContaining({
            assetId: BigInt(asset),
            balance: BigInt(3_000),
          })
        );
      })
    );

    await Promise.all(
      testAssetsId.map(async (asset) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller.addr),
            ...encodeUint64(asset),
            ...encodeUint64(0),
          ])
        );
        const boxDeposited = decodeUint64(boxContent.slice(0, 8), 'safe');
        const boxUnitaryPrice = decodeUint64(boxContent.slice(8, 16), 'safe');
        expect(boxDeposited).toEqual(3_000);
        expect(boxUnitaryPrice).toEqual(algos(1).microAlgos);
      })
    );
  });

  test('deposit', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');
    const { appAddress } = await appClient.appClient.getAppReference();

    const results = await Promise.all(
      testAssetsId.map(async (asset) =>
        appClient.deposit(
          {
            xfer: await algorand.transactions.assetTransfer({
              assetId: BigInt(asset),
              sender: stableSeller.addr,
              receiver: appAddress,
              amount: BigInt(1_000),
            }),
            nonce: 0,
          },
          { sender: stableSeller }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(appAddress, asset)).resolves.toEqual(
          expect.objectContaining({
            assetId: BigInt(asset),
            balance: BigInt(4_000),
          })
        );
      })
    );

    await Promise.all(
      testAssetsId.map(async (asset) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller.addr),
            ...encodeUint64(asset),
            ...encodeUint64(0),
          ])
        );
        const boxDeposited = decodeUint64(boxContent.slice(0, 8), 'safe');
        const boxUnitaryPrice = decodeUint64(boxContent.slice(8, 16), 'safe');
        expect(boxDeposited).toEqual(4_000);
        expect(boxUnitaryPrice).toEqual(algos(1).microAlgos);
      })
    );
  });

  test('setPrice', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');

    const results = await Promise.all(
      [
        [testAssetsId[0], algos(3.2).microAlgos],
        [testAssetsId[1], algos(5.7).microAlgos],
      ].map(async ([asset, unitaryPrice]) =>
        appClient.setPrice(
          {
            asset,
            nonce: 0,
            unitaryPrice,
          },
          { sender: stableSeller }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      [
        [testAssetsId[0], algos(3.2).microAlgos],
        [testAssetsId[1], algos(5.7).microAlgos],
      ].map(async ([asset, unitaryPrice]) => {
        const boxContent = await appClient.appClient.getBoxValue(
          new Uint8Array([
            ...getAccountAddressAsUint8Array(stableSeller.addr),
            ...encodeUint64(asset),
            ...encodeUint64(0),
          ])
        );
        const boxUnitaryPrice = decodeUint64(boxContent.slice(8, 16), 'safe');
        expect(boxUnitaryPrice).toEqual(unitaryPrice);
      })
    );
  });

  test('buy', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');
    const buyer = await algorand.account.fromKmd('buyer');

    await Promise.all(
      testAssetsId.map(async (asset) =>
        algorand.send.assetOptIn({
          assetId: BigInt(asset),
          sender: buyer.addr,
        })
      )
    );

    const results = await Promise.all(
      [
        [testAssetsId[0], 6.7936],
        [testAssetsId[1], 12.1011],
      ].map(async ([asset, amountToPay]) =>
        appClient.buy(
          {
            owner: stableSeller.addr,
            asset,
            nonce: 0,
            buyPay: await algorand.transactions.payment({
              sender: buyer.addr,
              receiver: stableSeller.addr,
              amount: algos(Number(amountToPay)),
              extraFee: microAlgos(1_000),
            }),
            quantity: 2_123,
          },
          { sender: buyer }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(buyer.addr, asset)).resolves.toEqual(
          expect.objectContaining({
            assetId: BigInt(asset),
            balance: BigInt(2_123),
          })
        );
      })
    );
  });

  test('withdraw', async () => {
    const { algorand } = fixture;
    const stableSeller = await algorand.account.fromKmd('stableSeller');

    const beforeCallAmount = (await algorand.account.getInformation(stableSeller.addr)).amount;

    const results = await Promise.all(
      testAssetsId.map(async (asset) =>
        appClient.withdraw(
          {
            asset,
            nonce: 0,
          },
          { sender: stableSeller, sendParams: { fee: algos(0.003) } }
        )
      )
    );

    results.map((result) => expect(result.confirmation).toBeDefined());

    const afterCallAmount = (await algorand.account.getInformation(stableSeller.addr)).amount;
    expect(afterCallAmount - beforeCallAmount).toEqual(2 * (forSaleMbr - 3_000));

    await Promise.all(
      testAssetsId.map(async (asset) => {
        await expect(algorand.account.getAssetInformation(stableSeller.addr, asset)).resolves.toEqual(
          expect.objectContaining({
            assetId: BigInt(asset),
            balance: BigInt(7_877),
          })
        );
      })
    );
  });
});
