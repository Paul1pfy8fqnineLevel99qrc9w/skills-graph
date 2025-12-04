// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EmployeeSkillsFHE is SepoliaConfig {
    struct EncryptedSkill {
        uint256 employeeId;
        euint32 encryptedSkillLevel;   // Encrypted skill level
        euint32 encryptedExperience;   // Encrypted years of experience
        euint32 encryptedDepartment;   // Encrypted department ID
        uint256 timestamp;
    }

    struct DecryptedSkill {
        string skillLevel;
        string experience;
        string department;
        bool isRevealed;
    }

    uint256 public skillCount;
    mapping(uint256 => EncryptedSkill) public encryptedSkills;
    mapping(uint256 => DecryptedSkill) public decryptedSkills;

    mapping(string => euint32) private encryptedDepartmentCount;
    string[] private departmentList;

    mapping(uint256 => uint256) private requestToSkillId;

    event SkillSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event SkillDecrypted(uint256 indexed id);

    modifier onlyEmployee(uint256 skillId) {
        // Placeholder for access control
        _;
    }

    /// @notice Submit a new encrypted skill record
    function submitEncryptedSkill(
        euint32 encryptedSkillLevel,
        euint32 encryptedExperience,
        euint32 encryptedDepartment
    ) public {
        skillCount += 1;
        uint256 newId = skillCount;

        encryptedSkills[newId] = EncryptedSkill({
            employeeId: newId,
            encryptedSkillLevel: encryptedSkillLevel,
            encryptedExperience: encryptedExperience,
            encryptedDepartment: encryptedDepartment,
            timestamp: block.timestamp
        });

        decryptedSkills[newId] = DecryptedSkill({
            skillLevel: "",
            experience: "",
            department: "",
            isRevealed: false
        });

        emit SkillSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of a skill record
    function requestSkillDecryption(uint256 skillId) public onlyEmployee(skillId) {
        EncryptedSkill storage skill = encryptedSkills[skillId];
        require(!decryptedSkills[skillId].isRevealed, "Already decrypted");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(skill.encryptedSkillLevel);
        ciphertexts[1] = FHE.toBytes32(skill.encryptedExperience);
        ciphertexts[2] = FHE.toBytes32(skill.encryptedDepartment);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSkill.selector);
        requestToSkillId[reqId] = skillId;

        emit DecryptionRequested(skillId);
    }

    /// @notice Callback for decrypted skill data
    function decryptSkill(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 skillId = requestToSkillId[requestId];
        require(skillId != 0, "Invalid request");

        EncryptedSkill storage eSkill = encryptedSkills[skillId];
        DecryptedSkill storage dSkill = decryptedSkills[skillId];
        require(!dSkill.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        string[] memory results = abi.decode(cleartexts, (string[]));

        dSkill.skillLevel = results[0];
        dSkill.experience = results[1];
        dSkill.department = results[2];
        dSkill.isRevealed = true;

        if (!FHE.isInitialized(encryptedDepartmentCount[dSkill.department])) {
            encryptedDepartmentCount[dSkill.department] = FHE.asEuint32(0);
            departmentList.push(dSkill.department);
        }
        encryptedDepartmentCount[dSkill.department] = FHE.add(
            encryptedDepartmentCount[dSkill.department],
            FHE.asEuint32(1)
        );

        emit SkillDecrypted(skillId);
    }

    /// @notice Get decrypted skill details
    function getDecryptedSkill(uint256 skillId) public view returns (
        string memory skillLevel,
        string memory experience,
        string memory department,
        bool isRevealed
    ) {
        DecryptedSkill storage s = decryptedSkills[skillId];
        return (s.skillLevel, s.experience, s.department, s.isRevealed);
    }

    /// @notice Get encrypted department count
    function getEncryptedDepartmentCount(string memory department) public view returns (euint32) {
        return encryptedDepartmentCount[department];
    }

    /// @notice Request department count decryption
    function requestDepartmentCountDecryption(string memory department) public {
        euint32 count = encryptedDepartmentCount[department];
        require(FHE.isInitialized(count), "Department not found");

        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(count);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptDepartmentCount.selector);
        requestToSkillId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(department)));
    }

    /// @notice Callback for decrypted department count
    function decryptDepartmentCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 deptHash = requestToSkillId[requestId];
        string memory department = getDepartmentFromHash(deptHash);

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32 count = abi.decode(cleartexts, (uint32));
        // Handle decrypted count as needed
    }

    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }

    function getDepartmentFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < departmentList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(departmentList[i]))) == hash) {
                return departmentList[i];
            }
        }
        revert("Department not found");
    }
}
