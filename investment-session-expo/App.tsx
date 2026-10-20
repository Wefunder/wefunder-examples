import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { openCheckout } from "./lib/checkout.ts";
import type { ReturnOutcome } from "./lib/return_url.ts";
import { getSession, listOfferings, mintSession, type OfferingSummary, type SessionStatus } from "./lib/server.ts";

type Phase =
  | { step: "idle" }
  | { step: "minting"; offeringId: string }
  | { step: "checking"; sessionId: string }
  | { step: "done"; returned: ReturnOutcome | { kind: "closed" }; session: SessionStatus | null; note?: string }
  | { step: "error"; message: string };

export default function App() {
  const [offerings, setOfferings] = useState<OfferingSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  useEffect(() => {
    listOfferings().then(setOfferings, (e: Error) => setLoadError(e.message));
  }, []);

  async function invest(offering: OfferingSummary) {
    if (!email.trim()) {
      setPhase({ step: "error", message: "Enter the investor's email first." });
      return;
    }
    setPhase({ step: "minting", offeringId: offering.id });
    try {
      // 1. Our server mints the session (the install token never leaves it).
      const session = await mintSession(offering.id, email.trim());
      // 2. Open the hosted page in the system browser sheet and wait for the return.
      const returned = await openCheckout(session.url);
      // 3. The return URL is a hint. Ask our server for the session's real status.
      setPhase({ step: "checking", sessionId: session.id });
      const status = await getSession(session.id).catch(() => null);
      setPhase({ step: "done", returned, session: status, note: status ? undefined : "Could not read the session status from the server." });
    } catch (e) {
      setPhase({ step: "error", message: (e as Error).message });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.title}>Invest through Wefunder</Text>
      <Text style={styles.label}>Investor email</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="investor@example.com"
        value={email}
        onChangeText={setEmail}
      />
      {loadError ? <Text style={styles.error}>Could not load offerings: {loadError}</Text> : null}
      {offerings === null && !loadError ? <ActivityIndicator /> : null}
      <FlatList
        data={offerings ?? []}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            disabled={phase.step === "minting" || phase.step === "checking"}
            onPress={() => invest(item)}
          >
            <Text style={styles.company}>{item.company_name}</Text>
            {item.tagline ? <Text style={styles.tagline}>{item.tagline}</Text> : null}
            <Text style={styles.cta}>{phase.step === "minting" && phase.offeringId === item.id ? "Opening…" : "Invest"}</Text>
          </Pressable>
        )}
      />
      <Outcome phase={phase} />
    </SafeAreaView>
  );
}

function Outcome({ phase }: { phase: Phase }) {
  switch (phase.step) {
    case "idle":
    case "minting":
      return null;
    case "checking":
      return <Text style={styles.status}>Checking session {phase.sessionId}…</Text>;
    case "error":
      return <Text style={styles.error}>{phase.message}</Text>;
    case "done": {
      const r = phase.returned;
      const came =
        r.kind === "success" ? "Returned on the success URL."
        : r.kind === "cancel" ? `Returned on the cancel URL (${r.reason ?? "no reason"}${r.sessionId ? `, ${r.sessionId}` : ""}).`
        : r.kind === "closed" ? "The investor closed the browser sheet."
        : "Returned on a URL this app does not recognise.";
      const s = phase.session;
      const real = s ? `Server says the session is ${s.status}${s.investment_id ? `, investment ${s.investment_id}` : ""}.` : phase.note;
      return (
        <View style={styles.result}>
          <Text style={styles.status}>{came}</Text>
          <Text style={styles.statusStrong}>{real}</Text>
        </View>
      );
    }
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: "600", marginTop: 12 },
  label: { fontSize: 13, color: "#555" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, fontSize: 16 },
  card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 12, padding: 16, marginVertical: 6, gap: 4 },
  cardPressed: { backgroundColor: "#f3f3f3" },
  company: { fontSize: 18, fontWeight: "600" },
  tagline: { color: "#555" },
  cta: { marginTop: 8, color: "#1a73e8", fontWeight: "600" },
  result: { gap: 4, paddingVertical: 8 },
  status: { color: "#333" },
  statusStrong: { fontWeight: "600" },
  error: { color: "#b00020" },
});
