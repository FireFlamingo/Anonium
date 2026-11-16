const { expect } = require("chai");
const { ethers, run } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { Identity, Group, generateProof } = require("@semaphore-protocol/core");
const { createHash } = require("crypto");

/** SHA-256 of the report text as a uint256 signal (same as the frontend). */
const reportSignal = (text) => BigInt("0x" + createHash("sha256").update(text, "utf8").digest("hex"));

const toSolidityProof = (p) => ({
  merkleTreeDepth: p.merkleTreeDepth,
  merkleTreeRoot: p.merkleTreeRoot,
  nullifier: p.nullifier,
  message: p.message,
  scope: p.scope,
  points: p.points,
});

describe("ZK Whistleblowing Platform", function () {
  async function deployFixture() {
    const [registrar, admin, outsider, relayer, newAdmin] = await ethers.getSigners();
    const { semaphore } = await run("deploy:semaphore", { logs: false });

    const groupManager = await ethers.deployContract("GroupManager", [await semaphore.getAddress()]);
    const verifier = await ethers.deployContract("WhistleblowVerifier", [
      await semaphore.getAddress(),
      await groupManager.getAddress(),
    ]);

    // Employees generate identities locally; only commitments go on-chain.
    const employees = Array.from({ length: 8 }, (_, i) => new Identity(`employee-secret-${i}`));
    const commitments = employees.map((e) => e.commitment);

    await groupManager.connect(admin).createGroup("Acme Pharma Ltd.");
    const groupId = 0n;
    await groupManager.connect(admin).addMembers(groupId, commitments);

    return { semaphore, groupManager, verifier, registrar, admin, outsider, relayer, newAdmin, employees, groupId };
  }

  async function buildGroup(groupManager, groupId) {
    const leaves = await groupManager.getMembers(groupId);
    return new Group(leaves.map((l) => BigInt(l)));
  }

  async function prove(identity, group, text) {
    const signal = reportSignal(text);
    return { signal, proof: await generateProof(identity, group, signal, signal) };
  }

  describe("GroupManager", function () {
    it("creates an organisation with the caller as admin", async function () {
      const { groupManager, admin, groupId } = await loadFixture(deployFixture);
      const org = await groupManager.getOrganization(groupId);
      expect(org.name).to.equal("Acme Pharma Ltd.");
      expect(org.admin).to.equal(admin.address);
      expect(org.activeMembers).to.equal(8n);
      expect(await groupManager.getOrganizationCount()).to.equal(1n);
    });

    it("rejects an empty organisation name", async function () {
      const { groupManager, admin } = await loadFixture(deployFixture);
      await expect(groupManager.connect(admin).createGroup("")).to.be.revertedWithCustomError(groupManager, "EmptyName");
    });

    it("only lets the group admin manage members", async function () {
      const { groupManager, outsider, groupId } = await loadFixture(deployFixture);
      const id = new Identity("intruder");
      await expect(groupManager.connect(outsider).addMember(groupId, id.commitment))
        .to.be.revertedWithCustomError(groupManager, "NotGroupAdmin")
        .withArgs(groupId, outsider.address);
    });

    it("rejects duplicate and zero commitments", async function () {
      const { groupManager, admin, employees, groupId } = await loadFixture(deployFixture);
      await expect(groupManager.connect(admin).addMember(groupId, employees[0].commitment))
        .to.be.revertedWithCustomError(groupManager, "AlreadyMember");
      await expect(groupManager.connect(admin).addMember(groupId, 0)).to.be.revertedWithCustomError(
        groupManager,
        "InvalidCommitment"
      );
    });

    it("keeps an off-chain-rebuildable tree whose root matches Semaphore", async function () {
      const { groupManager, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      expect(group.root).to.equal(await groupManager.getMerkleRoot(groupId));
    });

    it("removes a member and the rebuilt tree still matches on-chain", async function () {
      const { groupManager, admin, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const index = group.indexOf(employees[3].commitment);
      const { siblings } = group.generateMerkleProof(index);

      await expect(groupManager.connect(admin).removeMember(groupId, employees[3].commitment, siblings))
        .to.emit(groupManager, "MemberRemoved")
        .withArgs(groupId, employees[3].commitment, index);

      expect(await groupManager.isMember(groupId, employees[3].commitment)).to.equal(false);
      expect((await groupManager.getOrganization(groupId)).activeMembers).to.equal(7n);

      const rebuilt = await buildGroup(groupManager, groupId);
      expect(rebuilt.root).to.equal(await groupManager.getMerkleRoot(groupId));
    });

    it("transfers admin rights", async function () {
      const { groupManager, admin, newAdmin, groupId } = await loadFixture(deployFixture);
      await groupManager.connect(admin).transferAdmin(groupId, newAdmin.address);
      expect((await groupManager.getOrganization(groupId)).admin).to.equal(newAdmin.address);
      await expect(groupManager.connect(admin).transferAdmin(groupId, admin.address)).to.be.revertedWithCustomError(
        groupManager,
        "NotGroupAdmin"
      );
    });
  });

  describe("WhistleblowVerifier", function () {
    it("accepts a valid insider proof (sent by an unrelated relayer) and logs only hashes", async function () {
      const { groupManager, verifier, relayer, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const { signal, proof } = await prove(employees[2], group, "Batch 42 QA data was falsified.");

      await expect(verifier.connect(relayer).submitReport(groupId, toSolidityProof(proof)))
        .to.emit(verifier, "ReportVerified")
        .withArgs(0n, groupId, signal, proof.nullifier, proof.merkleTreeRoot, (t) => t > 0n);

      const [verified, gid, ts, corroborations] = await verifier.isVerified(signal);
      expect(verified).to.equal(true);
      expect(gid).to.equal(groupId);
      expect(ts).to.be.greaterThan(0n);
      expect(corroborations).to.equal(1n);
      expect(await verifier.nullifierUsed(groupId, proof.nullifier)).to.equal(true);
    });

    it("reports unknown signals as not verified", async function () {
      const { verifier } = await loadFixture(deployFixture);
      const [verified, , , corroborations] = await verifier.isVerified(reportSignal("never submitted"));
      expect(verified).to.equal(false);
      expect(corroborations).to.equal(0n);
    });

    it("blocks the same insider submitting the same report twice (nullifier)", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const { proof } = await prove(employees[1], group, "Same report");
      await verifier.submitReport(groupId, toSolidityProof(proof));
      await expect(verifier.submitReport(groupId, toSolidityProof(proof)))
        .to.be.revertedWithCustomError(verifier, "DuplicateSubmission")
        .withArgs(proof.nullifier);
    });

    it("counts a second insider's identical report as a corroboration", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const text = "Emissions numbers in the FY26 filing are understated.";
      const a = await prove(employees[0], group, text);
      const b = await prove(employees[5], group, text);
      expect(a.proof.nullifier).to.not.equal(b.proof.nullifier);

      await verifier.submitReport(groupId, toSolidityProof(a.proof));
      await verifier.submitReport(groupId, toSolidityProof(b.proof));
      const [, , , corroborations] = await verifier.isVerified(a.signal);
      expect(corroborations).to.equal(2n);
      expect((await verifier.getSubmissionsBySignal(a.signal)).length).to.equal(2);
    });

    it("rejects a proof from someone outside the group", async function () {
      const { groupManager, verifier, groupId } = await loadFixture(deployFixture);
      const outsider = new Identity("not-an-employee");
      // The outsider builds their own fake group containing themselves.
      const fakeGroup = new Group([outsider.commitment]);
      const { proof } = await prove(outsider, fakeGroup, "fake leak");
      await expect(verifier.submitReport(groupId, toSolidityProof(proof))).to.be.revertedWithCustomError(
        await ethers.getContractAt("ISemaphore", await groupManager.semaphore()),
        "Semaphore__MerkleTreeRootIsNotPartOfTheGroup"
      );
    });

    it("rejects a proof whose signal was tampered with", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const { proof } = await prove(employees[4], group, "original text");
      const tampered = reportSignal("edited text");
      const forged = { ...toSolidityProof(proof), message: tampered, scope: tampered };
      await expect(verifier.submitReport(groupId, forged)).to.be.revertedWithCustomError(verifier, "InvalidProof");
    });

    it("requires scope to equal the signal", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const signal = reportSignal("scope test");
      const proof = await generateProof(employees[6], group, signal, 12345n);
      await expect(verifier.submitReport(groupId, toSolidityProof(proof))).to.be.revertedWithCustomError(
        verifier,
        "ScopeMustEqualSignal"
      );
    });

    it("rejects reports for unregistered groups", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      const { proof } = await prove(employees[0], group, "x");
      await expect(verifier.submitReport(99, toSolidityProof(proof)))
        .to.be.revertedWithCustomError(verifier, "UnknownGroup")
        .withArgs(99);
    });

    it("lets a removed member prove only until the old root expires (revocation window)", async function () {
      const { groupManager, verifier, admin, employees, groupId } = await loadFixture(deployFixture);
      const before = await buildGroup(groupManager, groupId);
      // Proof generated while still a member.
      const early = await prove(employees[7], before, "pre-termination report");
      const late = await prove(employees[7], before, "post-expiry report");

      const idx = before.indexOf(employees[7].commitment);
      await groupManager.connect(admin).removeMember(groupId, employees[7].commitment, before.generateMerkleProof(idx).siblings);

      // Within the window the old root is still accepted (documented known limitation).
      await verifier.submitReport(groupId, toSolidityProof(early.proof));

      await time.increase(3601);
      const semaphore = await ethers.getContractAt("ISemaphore", await groupManager.semaphore());
      await expect(verifier.submitReport(groupId, toSolidityProof(late.proof))).to.be.revertedWithCustomError(
        semaphore,
        "Semaphore__MerkleTreeRootIsExpired"
      );
    });

    it("pages recent submissions newest-first", async function () {
      const { groupManager, verifier, employees, groupId } = await loadFixture(deployFixture);
      const group = await buildGroup(groupManager, groupId);
      for (let i = 0; i < 3; i++) {
        const { proof } = await prove(employees[i], group, `report #${i}`);
        await verifier.submitReport(groupId, toSolidityProof(proof));
      }
      const page = await verifier.getRecentSubmissions(0, 2);
      expect(page.length).to.equal(2);
      expect(page[0].id).to.equal(2n);
      expect(page[1].id).to.equal(1n);
      expect(await verifier.getSubmissionCount()).to.equal(3n);
      expect((await verifier.getRecentSubmissions(5, 2)).length).to.equal(0);
    });
  });
});
