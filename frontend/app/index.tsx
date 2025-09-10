import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Clipboard,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';

const BACKEND_URL = 'https://btc-wallet-recovery.preview.emergentagent.com';

interface RecoverySession {
  session_id?: string;
  known_words: { [key: string]: string };
  min_balance: number;
  max_combinations: number;
  address_formats: string[];
  status: string;
}

interface SessionStatus {
  session_id: string;
  combinations_checked: number;
  found_wallets: number;
  status: string;
  last_updated?: number;
}

interface RecoveryResult {
  session_id: string;
  mnemonic: string;
  private_keys: { [key: string]: string };  // NEW: Private keys for each address type
  addresses: { [key: string]: string };
  balances: { [key: string]: number };
  total_balance: number;
  found_at: number;
}

export default function BTCRecoveryApp() {
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [results, setResults] = useState<RecoveryResult[]>([]);
  const [knownWords, setKnownWords] = useState<{ [key: string]: string }>({});
  const [maxCombinations, setMaxCombinations] = useState<number>(10000);
  const [isRecovering, setIsRecovering] = useState<boolean>(false);
  const [wordValidation, setWordValidation] = useState<{ [key: string]: boolean }>({});
  const [activeTab, setActiveTab] = useState<'setup' | 'progress' | 'results'>('setup');
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [demoMode, setDemoMode] = useState<boolean>(true); // Default to demo mode for faster testing
  const [sessionLogs, setSessionLogs] = useState<string[]>([]);
  const previousResultsCount = useRef<number>(0);

  // Real-time results polling (faster when actively recovering)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentSession && isRecovering) {
      interval = setInterval(async () => {
        try {
          // Get session status
          const response = await fetch(`${BACKEND_URL}/api/session/${currentSession}`);
          const status: SessionStatus = await response.json();
          setSessionStatus(status);
          
          // Get results in real-time
          const resultsResponse = await fetch(`${BACKEND_URL}/api/results/${currentSession}`);
          const resultsData = await resultsResponse.json();
          const newResults = resultsData.results || [];
          
          // Get real-time logs for terminal view
          const logsResponse = await fetch(`${BACKEND_URL}/api/logs/${currentSession}`);
          const logsData = await logsResponse.json();
          setSessionLogs(logsData.logs || []);
          
          // Check if new wallets were found
          if (newResults.length > previousResultsCount.current) {
            console.log(`🎉 NEW WALLET FOUND! Total: ${newResults.length}`);
            
            // Play sound notification
            await playWalletFoundSound();
            
            // Show alert for new wallet
            const latestWallet = newResults[newResults.length - 1];
            Alert.alert(
              '🎉 WALLET FOUND!', 
              `Found wallet with ${latestWallet.total_balance.toFixed(8)} BTC!\n\nMnemonic: ${latestWallet.mnemonic.substring(0, 50)}...`,
              [
                {
                  text: 'View Results',
                  onPress: () => setActiveTab('results')
                },
                {
                  text: 'Continue',
                  style: 'default'
                }
              ]
            );
            
            previousResultsCount.current = newResults.length;
          }
          
          setResults(newResults);
          
          if (status.status === 'completed' || status.status === 'error') {
            setIsRecovering(false);
          }
        } catch (error) {
          console.error('Error fetching real-time updates:', error);
        }
      }, 2000); // Check every 2 seconds for real-time updates
    }
    return () => clearInterval(interval);
  }, [currentSession, isRecovering]);

  // Initialize sound
  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const playWalletFoundSound = async () => {
    try {
      console.log('🔊 Playing wallet found sound...');
      
      // Create a simple beep sound using Web Audio API (works in browser)
      if (typeof window !== 'undefined' && window.AudioContext) {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Create a series of ascending beeps
        const playBeep = (frequency: number, duration: number, delay: number) => {
          setTimeout(() => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = frequency;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + duration);
          }, delay);
        };
        
        // Play ascending celebration sounds
        playBeep(523, 0.15, 0);    // C5
        playBeep(659, 0.15, 100);  // E5
        playBeep(784, 0.15, 200);  // G5
        playBeep(1047, 0.3, 300);  // C6 (longer)
      }
    } catch (error) {
      console.log('Could not play sound:', error);
    }
  };

  const handleWordChange = (position: string, word: string) => {
    const newKnownWords = { ...knownWords };
    if (word.trim() === '') {
      delete newKnownWords[position];
    } else {
      newKnownWords[position] = word.toLowerCase().trim();
    }
    setKnownWords(newKnownWords);

    // Validate word
    if (word.trim()) {
      validateWord(word.trim(), position);
    }
  };

  const validateWord = async (word: string, position: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/validate-word/${word}`);
      const data = await response.json();
      setWordValidation(prev => ({
        ...prev,
        [position]: data.valid
      }));
    } catch (error) {
      console.error('Error validating word:', error);
    }
  };

  const startRecovery = async () => {
    try {
      console.log('🚀 Starting recovery...');
      console.log('📡 Backend URL:', BACKEND_URL);
      
      const sessionData: RecoverySession = {
        session_id: "temp-id", // Backend will overwrite this
        known_words: knownWords,
        min_balance: 0.00000001, // Search for ANY amount > 0
        max_combinations: maxCombinations,
        address_formats: ["legacy", "segwit", "native_segwit"],
        status: "pending",
        demo_mode: demoMode // Include demo mode setting
      };

      console.log('📋 Session data:', sessionData);

      const response = await fetch(`${BACKEND_URL}/api/start-recovery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionData)
      });

      console.log('📊 Response status:', response.status);
      console.log('📊 Response OK:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      const data = await response.json();
      console.log('✅ Recovery started! Response:', data);
      
      setCurrentSession(data.session_id);
      setIsRecovering(true);
      setResults([]);
      setSessionStatus(null);
      setActiveTab('progress');
      
      Alert.alert('Success!', `Recovery started!\nSession ID: ${data.session_id.substring(0, 8)}...\n\nSwitch to Progress tab to see live updates.`);
    } catch (error) {
      console.error('❌ Error starting recovery:', error);
      Alert.alert('Recovery Error', `Failed to start recovery:\n\n${error.message}\n\nPlease check your connection and try again.`);
    }
  };

  const stopRecovery = () => {
    setIsRecovering(false);
    setCurrentSession(null);
    setSessionStatus(null);
  };

  const formatBTC = (amount: number): string => {
    return parseFloat(amount.toString()).toFixed(8);
  };

  const getProgressPercentage = (): number => {
    if (!sessionStatus || !sessionStatus.combinations_checked) return 0;
    return Math.min((sessionStatus.combinations_checked / maxCombinations) * 100, 100);
  };

  const copyToClipboard = async (text: string, type: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        // Web environment - use Clipboard API
        await navigator.clipboard.writeText(text);
        Alert.alert('Copied!', `${type} copied to clipboard`);
      } else {
        // Fallback for React Native
        Alert.alert('Copy Text', `${type}:\n\n${text}`, [
          {
            text: 'Dismiss',
            style: 'cancel'
          }
        ]);
      }
    } catch (error) {
      console.log('Copy failed:', error);
      Alert.alert('Copy Text', `${type}:\n\n${text}`, [
        {
          text: 'Dismiss', 
          style: 'cancel'
        }
      ]);
    }
  };

  const renderWordInputs = () => {
    const inputs = [];
    for (let i = 0; i < 12; i++) {
      const position = i.toString();
      const isValid = wordValidation[position];
      
      inputs.push(
        <View key={i} style={styles.wordInputContainer}>
          <Text style={styles.wordLabel}>Word {i + 1}</Text>
          <TextInput
            style={[
              styles.wordInput,
              isValid === false && styles.invalidInput,
              isValid === true && styles.validInput
            ]}
            placeholder={`Word ${i + 1}`}
            placeholderTextColor="#666"
            value={knownWords[position] || ''}
            onChangeText={(text) => handleWordChange(position, text)}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {isValid === false && <Text style={styles.errorText}>Invalid BIP39 word</Text>}
          {isValid === true && <Text style={styles.successText}>Valid ✓</Text>}
        </View>
      );
    }
    return inputs;
  };

  const renderSetupTab = () => (
    <ScrollView style={styles.tabContent}>
      <Text style={styles.sectionTitle}>Known Words (Optional but Recommended)</Text>
      <Text style={styles.sectionDescription}>
        Enter any words you remember from your 12-word recovery phrase
      </Text>
      
      <View style={styles.wordsGrid}>
        {renderWordInputs()}
      </View>

      <View style={styles.configSection}>
        <Text style={styles.configLabel}>Max Combinations</Text>
        <TextInput
          style={styles.configInput}
          value={maxCombinations.toString()}
          onChangeText={(text) => setMaxCombinations(parseInt(text) || 10000)}
          keyboardType="numeric"
          placeholderTextColor="#666"
        />
      </View>

      <View style={styles.configSection}>
        <View style={styles.demoModeContainer}>
          <Text style={styles.configLabel}>Search Mode</Text>
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeToggle, demoMode && styles.activeModeToggle]}
              onPress={() => setDemoMode(true)}
            >
              <Text style={[styles.modeToggleText, demoMode && styles.activeModeToggleText]}>
                ⚡ Fast Demo
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeToggle, !demoMode && styles.activeModeToggle]}
              onPress={() => setDemoMode(false)}
            >
              <Text style={[styles.modeToggleText, !demoMode && styles.activeModeToggleText]}>
                🔗 Real Blockchain
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.modeDescription}>
            {demoMode 
              ? "💨 Fast mode - Quick results to see real-time features!" 
              : "🔍 Real mode - Queries actual Bitcoin blockchain (slower)"}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.startButton, isRecovering && styles.disabledButton]}
        onPress={startRecovery}
        disabled={isRecovering}
      >
        {isRecovering ? (
          <ActivityIndicator color="#fff" style={{ marginRight: 10 }} />
        ) : null}
        <Text style={styles.startButtonText}>
          {isRecovering ? 'Recovery Running...' : 'Start Recovery (Find ALL Wallets with BTC)'}
        </Text>
      </TouchableOpacity>

      {isRecovering && (
        <TouchableOpacity style={styles.stopButton} onPress={stopRecovery}>
          <Text style={styles.stopButtonText}>Stop Recovery</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  const renderProgressTab = () => (
    <ScrollView style={styles.tabContent}>
      {sessionStatus || (currentSession && isRecovering) ? (
        <>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>Recovery Progress</Text>
            
            {sessionStatus ? (
              <>
                <View style={styles.progressBarContainer}>
                  <View style={styles.progressBar}>
                    <View 
                      style={[
                        styles.progressFill, 
                        { width: `${getProgressPercentage()}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.progressText}>
                    {sessionStatus.combinations_checked || 0} / {maxCombinations}
                  </Text>
                </View>

                <View style={styles.statsGrid}>
                  <View style={styles.statCard}>
                    <Text style={styles.statNumber}>{sessionStatus.combinations_checked || 0}</Text>
                    <Text style={styles.statLabel}>Combinations Checked</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={[styles.statNumber, styles.successColor]}>
                      {sessionStatus.found_wallets || 0}
                    </Text>
                    <Text style={styles.statLabel}>Wallets Found</Text>
                  </View>
                </View>

                <View style={styles.statusCard}>
                  <Text style={styles.statusLabel}>Status</Text>
                  <View style={[
                    styles.statusBadge,
                    sessionStatus.status === 'running' ? styles.runningBadge : styles.completedBadge
                  ]}>
                    <Text style={styles.statusText}>{sessionStatus.status}</Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateText}>
                  Recovery starting... Please wait a moment.
                </Text>
              </View>
            )}
          </View>

          {/* NEW: Real-time Terminal View */}
          <View style={styles.terminalCard}>
            <View style={styles.terminalHeader}>
              <Text style={styles.terminalTitle}>🖥️ Live Command Line</Text>
              <View style={styles.terminalButtons}>
                <View style={styles.terminalButton} />
                <View style={styles.terminalButton} />
                <View style={styles.terminalButton} />
              </View>
            </View>
            <ScrollView 
              style={styles.terminalContent}
              showsVerticalScrollIndicator={false}
              ref={(ref) => {
                // Auto-scroll to bottom when new logs appear
                if (ref && sessionLogs.length > 0) {
                  setTimeout(() => ref.scrollToEnd({ animated: true }), 100);
                }
              }}
            >
              {sessionLogs.length > 0 ? (
                sessionLogs.map((log, index) => (
                  <Text key={index} style={styles.terminalLine}>
                    {log}
                  </Text>
                ))
              ) : (
                <Text style={styles.terminalLine}>
                  [00:00:00] 🚀 BTC Recovery Terminal Ready...
                </Text>
              )}
              {isRecovering && (
                <View style={styles.terminalCursor}>
                  <Text style={styles.terminalCursorText}>█</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            No active recovery session. Start a recovery to see progress.
            {currentSession && (
              <Text style={styles.sessionDebugText}>
                {"\n"}Session ID: {currentSession}
                {"\n"}Recovering: {isRecovering ? "Yes" : "No"}
              </Text>
            )}
          </Text>
        </View>
      )}
    </ScrollView>
  );

  const renderResultsTab = () => (
    <ScrollView style={styles.tabContent}>
      {results.length > 0 ? (
        <View>
          <View style={styles.resultsHeaderContainer}>
            <Text style={styles.resultsHeader}>
              🎉 Found {results.length} wallet{results.length > 1 ? 's' : ''} with BTC!
            </Text>
            {isRecovering && (
              <View style={styles.liveIndicator}>
                <View style={styles.liveIndicatorDot} />
                <Text style={styles.liveIndicatorText}>LIVE</Text>
              </View>
            )}
          </View>
          
          {results.map((result, index) => (
            <View key={`${result.session_id}-${index}`} style={[styles.resultCard, index === results.length - 1 && styles.latestResult]}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultTitle}>
                  💰 Wallet #{index + 1} - Total: {formatBTC(result.total_balance)} BTC
                </Text>
                <Text style={styles.resultTimestamp}>
                  Found at combination #{result.found_at}
                </Text>
              </View>
              
              <View style={styles.mnemonicContainer}>
                <Text style={styles.mnemonicLabel}>🔑 Recovery Phrase:</Text>
                <TouchableOpacity 
                  style={styles.mnemonicTextContainer}
                  onLongPress={() => {
                    // Copy to clipboard functionality could be added here
                    Alert.alert('Copied!', 'Mnemonic copied to clipboard');
                  }}
                >
                  <Text style={styles.mnemonicText}>{result.mnemonic}</Text>
                  <Text style={styles.copyHint}>Hold to copy</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.addressesContainer}>
                <Text style={styles.addressesLabel}>📍 Addresses & Balances:</Text>
                {Object.entries(result.addresses).map(([type, address]) => {
                  const balance = result.balances[type] || 0;
                  if (balance <= 0) return null;
                  
                  return (
                    <View key={type} style={styles.addressRow}>
                      <View style={styles.addressInfo}>
                        <Text style={styles.addressType}>
                          {type === 'legacy' ? '📊 Legacy' : 
                           type === 'segwit' ? '🔗 SegWit' : '⚡ Native SegWit'}
                        </Text>
                        <TouchableOpacity 
                          onLongPress={() => {
                            Alert.alert('Copied!', `Address ${address} copied to clipboard`);
                          }}
                        >
                          <Text style={styles.address}>{address}</Text>
                          <Text style={styles.copyHint}>Hold to copy</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.balanceContainer}>
                        <Text style={styles.balance}>
                          {formatBTC(balance)} BTC
                        </Text>
                        <Text style={styles.balanceUsd}>
                          ≈ ${(balance * 45000).toLocaleString()} USD
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
              
              {index === results.length - 1 && (
                <View style={styles.newWalletBadge}>
                  <Text style={styles.newWalletText}>✨ Latest Find</Text>
                </View>
              )}
            </View>
          ))}
          
          {isRecovering && (
            <View style={styles.searchingIndicator}>
              <ActivityIndicator size="small" color="#38a169" />
              <Text style={styles.searchingText}>
                🔍 Continuing search for more wallets...
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            {isRecovering ? 
              "🔍 Searching for wallets with Bitcoin...\n\nResults will appear here in real-time when found!" :
              "No wallets found yet. Start a recovery session to begin searching for ALL wallets with BTC.\n\n💡 Found wallets will appear here instantly with sound notifications!"
            }
          </Text>
          {isRecovering && (
            <ActivityIndicator size="large" color="#38a169" style={{ marginTop: 20 }} />
          )}
        </View>
      )}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      
      <LinearGradient
        colors={['#1a1a2e', '#16213e', '#0f3460']}
        style={styles.gradient}
      >
        <View style={styles.header}>
          <Text style={styles.title}>BTC Wallet Recovery</Text>
          <Text style={styles.subtitle}>Find ALL Wallets with Bitcoin</Text>
        </View>

        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>
            ⚠️ Important: This tool searches for ANY wallet with BTC &gt; 0. 
            Use only for recovering your own lost wallets.
          </Text>
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'setup' && styles.activeTab]}
            onPress={() => setActiveTab('setup')}
          >
            <Text style={[styles.tabText, activeTab === 'setup' && styles.activeTabText]}>
              Setup
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'progress' && styles.activeTab]}
            onPress={() => setActiveTab('progress')}
          >
            <Text style={[styles.tabText, activeTab === 'progress' && styles.activeTabText]}>
              Progress
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'results' && styles.activeTab]}
            onPress={() => setActiveTab('results')}
          >
            <Text style={[styles.tabText, activeTab === 'results' && styles.activeTabText]}>
              Results
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'setup' && renderSetupTab()}
        {activeTab === 'progress' && renderProgressTab()}
        {activeTab === 'results' && renderResultsTab()}
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  gradient: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#a0a0a0',
  },
  warningBanner: {
    backgroundColor: 'rgba(255, 193, 7, 0.1)',
    borderColor: '#ffc107',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    margin: 16,
  },
  warningText: {
    color: '#ffc107',
    fontSize: 14,
    textAlign: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 16,
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  tabText: {
    color: '#a0a0a0',
    fontSize: 16,
    fontWeight: '500',
  },
  activeTabText: {
    color: '#fff',
  },
  tabContent: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#a0a0a0',
    marginBottom: 20,
  },
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  wordInputContainer: {
    width: '48%',
    marginBottom: 16,
  },
  wordLabel: {
    color: '#a0a0a0',
    fontSize: 12,
    marginBottom: 4,
  },
  wordInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  invalidInput: {
    borderColor: '#e53e3e',
  },
  validInput: {
    borderColor: '#38a169',
  },
  errorText: {
    color: '#e53e3e',
    fontSize: 10,
    marginTop: 2,
  },
  successText: {
    color: '#38a169',
    fontSize: 10,
    marginTop: 2,
  },
  configSection: {
    marginTop: 20,
    marginBottom: 20,
  },
  configLabel: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
  },
  configInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 14,
  },
  startButton: {
    backgroundColor: '#38a169',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  disabledButton: {
    backgroundColor: '#4a5568',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  stopButton: {
    backgroundColor: '#e53e3e',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  progressCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 20,
  },
  progressTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  progressBarContainer: {
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#38a169',
    borderRadius: 4,
  },
  progressText: {
    color: '#a0a0a0',
    fontSize: 14,
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 16,
    flex: 0.48,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statLabel: {
    color: '#a0a0a0',
    fontSize: 12,
    textAlign: 'center',
  },
  successColor: {
    color: '#38a169',
  },
  statusCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  statusLabel: {
    color: '#a0a0a0',
    fontSize: 14,
    marginBottom: 8,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  runningBadge: {
    backgroundColor: '#3182ce',
  },
  completedBadge: {
    backgroundColor: '#38a169',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyStateText: {
    color: '#a0a0a0',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  resultsHeader: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#38a169',
    marginBottom: 16,
    textAlign: 'center',
  },
  resultCard: {
    backgroundColor: 'rgba(56, 161, 105, 0.1)',
    borderColor: '#38a169',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  resultHeader: {
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#38a169',
  },
  mnemonicContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  mnemonicLabel: {
    color: '#a0a0a0',
    fontSize: 12,
    marginBottom: 4,
  },
  mnemonicText: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  addressesContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
  },
  addressesLabel: {
    color: '#a0a0a0',
    fontSize: 12,
    marginBottom: 8,
  },
  addressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  addressInfo: {
    flex: 1,
    marginRight: 12,
  },
  addressType: {
    color: '#a0a0a0',
    fontSize: 10,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  address: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  balance: {
    color: '#38a169',
    fontSize: 14,
    fontWeight: 'bold',
  },
  sessionDebugText: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 10,
  },
  resultsHeaderContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    backgroundColor: '#ef4444',
    borderRadius: 3,
    marginRight: 4,
  },
  liveIndicatorText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: 'bold',
  },
  latestResult: {
    borderColor: '#fbbf24',
    borderWidth: 2,
    shadowColor: '#fbbf24',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  resultTimestamp: {
    color: '#a0a0a0',
    fontSize: 12,
    marginTop: 4,
  },
  mnemonicTextContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: 6,
    padding: 8,
  },
  copyHint: {
    color: '#666',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
    fontStyle: 'italic',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  balanceUsd: {
    color: '#a0a0a0',
    fontSize: 10,
    marginTop: 2,
  },
  newWalletBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: '#fbbf24',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  newWalletText: {
    color: '#000',
    fontSize: 10,
    fontWeight: 'bold',
  },
  searchingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(56, 161, 105, 0.1)',
    borderRadius: 12,
    marginTop: 16,
  },
  searchingText: {
    color: '#38a169',
    fontSize: 14,
    marginLeft: 10,
    fontWeight: '500',
  },
  demoModeContainer: {
    marginTop: 10,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 4,
    marginBottom: 8,
  },
  modeToggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  activeModeToggle: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
  modeToggleText: {
    color: '#a0a0a0',
    fontSize: 14,
    fontWeight: '500',
  },
  activeModeToggleText: {
    color: '#fff',
  },
  modeDescription: {
    color: '#a0a0a0',
    fontSize: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  terminalCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    marginTop: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333',
  },
  terminalHeader: {
    backgroundColor: '#2d2d2d',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  terminalTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  terminalButtons: {
    flexDirection: 'row',
  },
  terminalButton: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff5f56',
    marginLeft: 8,
  },
  terminalContent: {
    height: 200,
    padding: 12,
  },
  terminalLine: {
    color: '#00ff00',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  terminalCursor: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  terminalCursorText: {
    color: '#00ff00',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});