import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryConversationRepository,
  CONVERSATION_CONFIG,
  generateDeterministicTitle,
  IConversationRepository
} from "../../src/data/firestore/index.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";

describe("Milestone: Persistent Conversation History", () => {
  let repo: InMemoryConversationRepository;
  const testUserId = "user_baris_test";

  beforeEach(() => {
    repo = new InMemoryConversationRepository();
  });

  it("Scenario 1: Create Conversation creates metadata with zero messageCount", async () => {
    const conv = await repo.createConversation({
      userId: testUserId,
      title: "Initial Exploration"
    });

    expect(conv).toBeDefined();
    expect(conv.id).toBeDefined();
    expect(conv.userId).toBe(testUserId);
    expect(conv.title).toBe("Initial Exploration");
    expect(conv.messageCount).toBe(0);
    expect(conv.createdAt).toBeInstanceOf(Date);
    expect(conv.updatedAt).toBeInstanceOf(Date);
    expect(conv.lastMessageAt).toBeInstanceOf(Date);
  });

  it("Scenario 2: Persist User Message increments count to 1 and derives deterministic title", async () => {
    const conv = await repo.createConversation({
      userId: testUserId
    });
    expect(conv.title).toBe(CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE);

    const userMessageContent = "What is our architectural philosophy regarding type safety?";
    const userMsg = await repo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: userMessageContent
    });

    expect(userMsg).toBeDefined();
    expect(userMsg.sequence).toBe(1);
    expect(userMsg.role).toBe("user");
    expect(userMsg.content).toBe(userMessageContent);
    expect(userMsg.status).toBe("completed");

    // Conversation record updated
    const updatedConv = await repo.getConversation(conv.id);
    expect(updatedConv).not.toBeNull();
    expect(updatedConv!.messageCount).toBe(1);
    expect(updatedConv!.title).toBe(generateDeterministicTitle(userMessageContent));
  });

  it("Scenario 3: Persist Assistant Message increments count to 2 and records provider metadata", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    await repo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "Hello, Alfred."
    });

    const assistantMsg = await repo.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Good morning, sir. I trust you are well.",
      status: "completed",
      provider: "ollama",
      model: "gemma4:12b-mlx",
      finishReason: "stop"
    });

    expect(assistantMsg.sequence).toBe(2);
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.provider).toBe("ollama");
    expect(assistantMsg.model).toBe("gemma4:12b-mlx");
    expect(assistantMsg.status).toBe("completed");

    const updatedConv = await repo.getConversation(conv.id);
    expect(updatedConv!.messageCount).toBe(2);
  });

  it("Scenario 4: Retrieve Chronological History maintains 1..N order", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    for (let i = 1; i <= 6; i++) {
      await repo.appendMessage({
        conversationId: conv.id,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Message ${i}`
      });
    }

    const messages = await repo.getMessages(conv.id, { limit: 10 });
    expect(messages.length).toBe(6);

    for (let i = 0; i < 6; i++) {
      expect(messages[i].sequence).toBe(i + 1);
      expect(messages[i].content).toBe(`Message ${i + 1}`);
    }
  });

  it("Scenario 5: Bounded Context Window returns only the latest 10 messages in ascending order", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    // Append 16 messages
    for (let i = 1; i <= 16; i++) {
      await repo.appendMessage({
        conversationId: conv.id,
        role: i % 2 === 1 ? "user" : "assistant",
        content: `Turn number ${i}`
      });
    }

    const bounded = await repo.getMessages(conv.id, { limit: CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES });
    expect(bounded.length).toBe(10);

    // Oldest should be sequence 7, newest should be sequence 16
    expect(bounded[0].sequence).toBe(7);
    expect(bounded[0].content).toBe("Turn number 7");
    expect(bounded[9].sequence).toBe(16);
    expect(bounded[9].content).toBe("Turn number 16");

    // All must be strictly increasing
    for (let i = 1; i < bounded.length; i++) {
      expect(bounded[i].sequence).toBe(bounded[i - 1].sequence + 1);
    }
  });

  it("Scenario 6: Atomic Sequence Ordering guarantees monotonically increasing numbers", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    const appendPromises = Array.from({ length: 10 }, (_, i) =>
      repo.appendMessage({
        conversationId: conv.id,
        role: "user",
        content: `Concurrent prompt ${i}`
      })
    );

    const results = await Promise.all(appendPromises);
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);

    // Should contain 1 through 10 with no duplicates or gaps
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const finalConv = await repo.getConversation(conv.id);
    expect(finalConv!.messageCount).toBe(10);
  });

  it("Scenario 7: Interrupted Stream records status: 'interrupted'", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    await repo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "Explain quantum mechanics in detail."
    });

    const interruptedMsg = await repo.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Quantum mechanics is a fundamental theory in physics that",
      status: "interrupted",
      provider: "ollama"
    });

    expect(interruptedMsg.status).toBe("interrupted");
    expect(interruptedMsg.content).toContain("fundamental theory");

    const messages = await repo.getMessages(conv.id);
    expect(messages[1].status).toBe("interrupted");
  });

  it("Scenario 8: Provider Failure records status: 'error' without corrupting sequence", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    await repo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "Trigger failure test."
    });

    // Record provider failure
    const errorMsg = await repo.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "",
      status: "error",
      provider: "failing-provider"
    });

    expect(errorMsg.sequence).toBe(2);
    expect(errorMsg.status).toBe("error");

    // Can still append subsequent messages normally
    const retryMsg = await repo.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Apologies, sir. Connectivity has been restored.",
      status: "completed",
      provider: "fallback-persona"
    });

    expect(retryMsg.sequence).toBe(3);
    expect(retryMsg.status).toBe("completed");
  });

  it("Scenario 9: User Ownership and Isolation partitions conversations by userId", async () => {
    const aliceConv = await repo.createConversation({ userId: "alice", title: "Alice's Chat" });
    const bobConv = await repo.createConversation({ userId: "bob", title: "Bob's Chat" });
    const aliceConv2 = await repo.createConversation({ userId: "alice", title: "Alice's Second Chat" });

    const aliceList = await repo.listConversations("alice");
    const bobList = await repo.listConversations("bob");

    expect(aliceList.length).toBe(2);
    expect(aliceList.every((c) => c.userId === "alice")).toBe(true);
    expect(bobList.length).toBe(1);
    expect(bobList[0].id).toBe(bobConv.id);
  });

  it("Scenario 10: Conversation Continuation resumes sequence from previous count", async () => {
    const conv = await repo.createConversation({ userId: testUserId });

    // Turn 1
    await repo.appendMessage({ conversationId: conv.id, role: "user", content: "What is 2 + 2?" });
    await repo.appendMessage({ conversationId: conv.id, role: "assistant", content: "Four, sir." });

    const initialConv = await repo.getConversation(conv.id);
    expect(initialConv!.messageCount).toBe(2);

    // Resume conversation later
    const turn2User = await repo.appendMessage({
      conversationId: conv.id,
      role: "user",
      content: "And multiply that by 3?"
    });
    expect(turn2User.sequence).toBe(3);

    const turn2Asst = await repo.appendMessage({
      conversationId: conv.id,
      role: "assistant",
      content: "Twelve, sir."
    });
    expect(turn2Asst.sequence).toBe(4);

    const finalConv = await repo.getConversation(conv.id);
    expect(finalConv!.messageCount).toBe(4);
  });

  describe("ContextBuilder Integration with Persistent History", () => {
    it("builds chat messages including Persona, Governor, Bounded History and Current Message", async () => {
      const conv = await repo.createConversation({ userId: testUserId });

      // Add 12 turns
      for (let i = 1; i <= 12; i++) {
        await repo.appendMessage({
          conversationId: conv.id,
          role: i % 2 === 1 ? "user" : "assistant",
          content: `Previous content ${i}`
        });
      }

      const recentHistory = await repo.getMessages(conv.id, {
        limit: CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES
      });

      const assembled = ContextBuilder.buildChatMessages({
        personaPrompt: "You are Alfred.",
        history: recentHistory.map((m) => ({ role: m.role, content: m.content })),
        currentMessage: "What was my first message in this window?"
      });

      // 1 System prompt + 10 Bounded turns + 1 Current user message = 12 total messages
      expect(assembled.length).toBe(12);
      expect(assembled[0].role).toBe("system");
      expect(assembled[0].content).toContain("You are Alfred.");
      expect(assembled[0].content).toContain("CANONICAL USER PROFILE");
      expect(assembled[0].content).toContain("CONVERSATIONAL GOVERNOR");

      // Last item is current message
      expect(assembled[assembled.length - 1].role).toBe("user");
      expect(assembled[assembled.length - 1].content).toBe("What was my first message in this window?");
    });
  });

  describe("Deterministic Title Generator", () => {
    it("generates a neat title from the first 6 words up to 40 characters", () => {
      const title1 = generateDeterministicTitle("How would you summarize my engineering philosophy in two sentences?");
      expect(title1).toBe("How would you summarize my engineering philosophy in two");
      expect(title1.length).toBeLessThanOrEqual(CONVERSATION_CONFIG.MAX_TITLE_LENGTH);

      const title2 = generateDeterministicTitle("   ### hello alfred   ");
      expect(title2).toBe("Hello alfred");

      const title3 = generateDeterministicTitle("");
      expect(title3).toBe("New Conversation");
    });
  });
});
