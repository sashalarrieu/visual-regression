import { StyleSheet, Text, View } from "react-native";

type DemoProfileHeaderProps = {
  name: string;
  role: string;
  status?: "online" | "offline" | "busy";
};

const statusColors = {
  online: "#16a34a",
  offline: "#9ca3af",
  busy: "#f59e0b",
} as const;

export const DemoProfileHeader = ({ name, role, status = "online" }: DemoProfileHeaderProps) => (
  <View style={styles.container}>
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
      <View style={[styles.statusDot, { backgroundColor: statusColors[status] }]} />
    </View>
    <View style={styles.info}>
      <Text style={styles.name}>{name}</Text>
      <Text style={styles.role}>{role}</Text>
    </View>
  </View>
);

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    backgroundColor: "#ede9fe",
    borderRadius: 999,
    height: 64,
    justifyContent: "center",
    position: "relative",
    width: 64,
  },
  avatarText: {
    color: "#6d28d9",
    fontSize: 24,
    fontWeight: "700",
  },
  container: {
    alignItems: "center",
    backgroundColor: "#f9fafb",
    borderColor: "#e5e7eb",
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: "row",
    gap: 16,
    padding: 20,
    width: 320,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    color: "#111827",
    fontSize: 20,
    fontWeight: "700",
  },
  role: {
    color: "#6b7280",
    fontSize: 14,
  },
  statusDot: {
    borderColor: "#ffffff",
    borderRadius: 999,
    borderWidth: 2,
    bottom: 2,
    height: 14,
    position: "absolute",
    right: 2,
    width: 14,
  },
});
