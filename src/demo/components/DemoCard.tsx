import { StyleSheet, Text, View } from "react-native";

type DemoCardProps = {
  title: string;
  description: string;
  badge?: string;
  highlighted?: boolean;
};

export const DemoCard = ({ title, description, badge, highlighted = false }: DemoCardProps) => (
  <View style={[styles.card, highlighted && styles.cardHighlighted]}>
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </View>
    <Text style={styles.description}>{description}</Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#dbeafe",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    color: "#1d4ed8",
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#e5e7eb",
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    maxWidth: 360,
    padding: 20,
    width: "100%",
  },
  cardHighlighted: {
    borderColor: "#2563eb",
    shadowColor: "#2563eb",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  description: {
    color: "#4b5563",
    fontSize: 15,
    lineHeight: 22,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  title: {
    color: "#111827",
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
  },
});
