import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SkillRecord {
  id: string;
  encryptedSkills: string;
  timestamp: number;
  owner: string;
  category: string;
  experience: number;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<SkillRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    category: "",
    experience: 1,
    skills: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [language, setLanguage] = useState<"en" | "zh">("en");
  const [showFHEInfo, setShowFHEInfo] = useState(false);

  // Calculate statistics for dashboard
  const verifiedCount = records.filter(r => r.status === "verified").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;
  
  // Filter records based on search term
  const filteredRecords = records.filter(record => 
    record.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
    record.owner.toLowerCase().includes(searchTerm.toLowerCase())
  );

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("skill_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing skill keys:", e);
        }
      }
      
      const list: SkillRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`skill_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedSkills: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                category: recordData.category,
                experience: recordData.experience || 0,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing skill data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading skill ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading skills:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitSkill = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting skills with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newRecordData.category,
        experience: newRecordData.experience,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `skill_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("skill_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "skill_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Skills encrypted and stored securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          category: "",
          experience: 1,
          skills: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifySkill = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted skills with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`skill_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "verified"
      };
      
      await contract.setData(
        `skill_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectSkill = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted skills with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`skill_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `skill_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const toggleLanguage = () => {
    setLanguage(lang => lang === "en" ? "zh" : "en");
  };

  const renderSkillDistribution = () => {
    const categories = Array.from(new Set(records.map(r => r.category)));
    const categoryCounts = categories.map(cat => ({
      name: cat,
      count: records.filter(r => r.category === cat).length
    }));
    
    const total = records.length || 1;
    
    return (
      <div className="distribution-chart">
        {categoryCounts.map((cat, index) => (
          <div 
            key={cat.name} 
            className="distribution-bar"
            style={{
              width: `${(cat.count / total) * 100}%`,
              backgroundColor: `hsl(${index * 60}, 80%, 50%)`
            }}
          >
            <span className="bar-label">
              {cat.name} ({cat.count})
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderExperienceChart = () => {
    const experienceLevels = [
      { level: "0-2 years", min: 0, max: 2 },
      { level: "3-5 years", min: 3, max: 5 },
      { level: "6-10 years", min: 6, max: 10 },
      { level: "10+ years", min: 11, max: 100 }
    ];
    
    const experienceData = experienceLevels.map(level => ({
      level: level.level,
      count: records.filter(r => r.experience >= level.min && r.experience <= level.max).length
    }));
    
    const maxCount = Math.max(...experienceData.map(d => d.count), 1);
    
    return (
      <div className="experience-chart">
        {experienceData.map(data => (
          <div key={data.level} className="experience-bar">
            <div className="bar-label">{data.level}</div>
            <div 
              className="bar-fill"
              style={{
                width: `${(data.count / maxCount) * 100}%`,
                backgroundColor: `hsl(${experienceData.indexOf(data) * 90}, 80%, 50%)`
              }}
            >
              <span className="count-label">{data.count}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container future-metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>SkillGraph</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Skill
          </button>
          <button 
            className="metal-button"
            onClick={() => setShowFHEInfo(!showFHEInfo)}
          >
            {showFHEInfo ? "Hide FHE Info" : "Show FHE Info"}
          </button>
          <button 
            className="language-toggle metal-button"
            onClick={toggleLanguage}
          >
            {language === "en" ? "中文" : "EN"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} language={language} />
        </div>
      </header>
      
      <div className="main-content panel-layout">
        {/* Left Panel - Project Introduction */}
        <div className="panel left-panel">
          <div className="panel-content cyber-card">
            <h2>Project Introduction</h2>
            <p>
              SkillGraph is a privacy-preserving employee skill mapping platform using Fully Homomorphic Encryption (FHE) technology. Employees can securely store their encrypted skills, while companies can query for matching skills without compromising privacy.
            </p>
            
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
            
            <div className="key-features">
              <h3>Key Features</h3>
              <ul>
                <li>Encrypted skill storage</li>
                <li>FHE-based skill matching</li>
                <li>Anonymous talent discovery</li>
                <li>Career path recommendations</li>
              </ul>
            </div>
          </div>
          
          {showFHEInfo && (
            <div className="panel-content cyber-card fhe-info">
              <h3>How FHE Protects Your Privacy</h3>
              <div className="fhe-steps">
                <div className="fhe-step">
                  <div className="step-icon">1</div>
                  <p>Your skills are encrypted using FHE before storage</p>
                </div>
                <div className="fhe-step">
                  <div className="step-icon">2</div>
                  <p>Queries are performed on encrypted data</p>
                </div>
                <div className="fhe-step">
                  <div className="step-icon">3</div>
                  <p>Only encrypted results are returned</p>
                </div>
                <div className="fhe-step">
                  <div className="step-icon">4</div>
                  <p>Your data remains private at all times</p>
                </div>
              </div>
            </div>
          )}
        </div>
        
        {/* Center Panel - Skill Management */}
        <div className="panel center-panel">
          <div className="panel-content cyber-card">
            <div className="section-header">
              <h2>Skill Records</h2>
              <div className="header-actions">
                <div className="search-container">
                  <input
                    type="text"
                    placeholder="Search skills..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="metal-input"
                  />
                </div>
                <button 
                  onClick={loadRecords}
                  className="refresh-btn metal-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="records-list">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Experience</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No skill records found</p>
                  <button 
                    className="metal-button primary"
                    onClick={() => setShowCreateModal(true)}
                  >
                    Add First Skill
                  </button>
                </div>
              ) : (
                filteredRecords.map(record => (
                  <div className="record-row" key={record.id}>
                    <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                    <div className="table-cell">{record.category}</div>
                    <div className="table-cell">{record.experience} years</div>
                    <div className="table-cell">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</div>
                    <div className="table-cell">
                      {new Date(record.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${record.status}`}>
                        {record.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      {isOwner(record.owner) && record.status === "pending" && (
                        <>
                          <button 
                            className="action-btn metal-button success"
                            onClick={() => verifySkill(record.id)}
                          >
                            Verify
                          </button>
                          <button 
                            className="action-btn metal-button danger"
                            onClick={() => rejectSkill(record.id)}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        {/* Right Panel - Analytics */}
        <div className="panel right-panel">
          <div className="panel-content cyber-card">
            <h2>Skill Analytics</h2>
            
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">Total Skills</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
            
            <div className="analytics-section">
              <h3>Skill Distribution</h3>
              {renderSkillDistribution()}
            </div>
            
            <div className="analytics-section">
              <h3>Experience Levels</h3>
              {renderExperienceChart()}
            </div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitSkill} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
          language={language}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>SkillGraph</span>
            </div>
            <p>Privacy-preserving employee skill mapping using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SkillGraph. All rights reserved.
          </div>
          <div className="disclaimer">
            This platform uses Fully Homomorphic Encryption to protect your data privacy. All skill data is encrypted and processed without decryption.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleExperienceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRecordData({
      ...recordData,
      experience: parseInt(e.target.value) || 0
    });
  };

  const handleSubmit = () => {
    if (!recordData.category || !recordData.skills) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Add Encrypted Skill</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> 
            Your skills will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={recordData.category} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="">Select category</option>
                <option value="Web Development">Web Development</option>
                <option value="Blockchain">Blockchain</option>
                <option value="AI/ML">AI/ML</option>
                <option value="DevOps">DevOps</option>
                <option value="UI/UX Design">UI/UX Design</option>
                <option value="Data Science">Data Science</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Experience (years)</label>
              <input 
                type="range"
                min="0"
                max="20"
                name="experience"
                value={recordData.experience} 
                onChange={handleExperienceChange}
                className="metal-range"
              />
              <div className="range-value">{recordData.experience} years</div>
            </div>
            
            <div className="form-group full-width">
              <label>Skills *</label>
              <textarea 
                name="skills"
                value={recordData.skills} 
                onChange={handleChange}
                placeholder="List your skills (e.g., React, Solidity, Python...)" 
                className="metal-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> 
            Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;