import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const BACKEND_URL = 'https://dev-assistant-37.preview.emergentagent.com';

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

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (currentSession && isRecovering) {
      interval = setInterval(async () => {
        try {
          const response = await fetch(`${BACKEND_URL}/api/session/${currentSession}`);
          const status: SessionStatus = await response.json();
          setSessionStatus(status);
          
          if (status.status === 'completed' || status.status === 'error') {
            setIsRecovering(false);
            // Fetch results
            const resultsResponse = await fetch(`${BACKEND_URL}/api/results/${currentSession}`);
            const resultsData = await resultsResponse.json();
            setResults(resultsData.results || []);
          }
        } catch (error) {
          console.error('Error fetching session status:', error);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [currentSession, isRecovering]);

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
        status: "pending"
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
          <Text style={styles.resultsHeader}>
            Found {results.length} wallet{results.length > 1 ? 's' : ''} with BTC!
          </Text>
          {results.map((result, index) => (
            <View key={index} style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <Text style={styles.resultTitle}>
                  Wallet Found! Total: {formatBTC(result.total_balance)} BTC
                </Text>
              </View>
              
              <View style={styles.mnemonicContainer}>
                <Text style={styles.mnemonicLabel}>Recovery Phrase:</Text>
                <Text style={styles.mnemonicText}>{result.mnemonic}</Text>
              </View>

              <View style={styles.addressesContainer}>
                <Text style={styles.addressesLabel}>Addresses & Balances:</Text>
                {Object.entries(result.addresses).map(([type, address]) => (
                  <View key={type} style={styles.addressRow}>
                    <View style={styles.addressInfo}>
                      <Text style={styles.addressType}>{type}</Text>
                      <Text style={styles.address}>{address}</Text>
                    </View>
                    <Text style={styles.balance}>
                      {formatBTC(result.balances[type] || 0)} BTC
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyStateText}>
            No wallets found yet. Start a recovery session to begin searching for ALL wallets with BTC.
          </Text>
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
});