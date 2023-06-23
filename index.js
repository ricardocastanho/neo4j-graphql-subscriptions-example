import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import neo4j from "neo4j-driver";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { useServer } from "graphql-ws/lib/use/ws";
import { RedisPubSub } from "graphql-redis-subscriptions";
import {
  Neo4jGraphQL,
  Neo4jGraphQLSubscriptionsSingleInstancePlugin,
} from "@neo4j/graphql";

const HOST = "localhost";
const PATH = "/graphql";
const PORT = 4001;
const NEO4J_URL = "bolt://34.232.46.151:7687";
const NEO4J_USER = "neo4j";
const NEO4J_PASSWORD = "itinerary-gallon-holddown";
const REDIS_URL = "redis://default:default@localhost:6379";
const EVENT_KEY = "NOTIFICATION";

const driver = neo4j.driver(
  NEO4J_URL,
  neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD)
);

const pubsub = new RedisPubSub({
  connection: REDIS_URL,
});

const typeDefs = `
  type Movie {
    id: ID!
    title: String!
    released: Int
    actors: [Actor!]! @relationship(type: "ACTED_IN", direction: OUT)
  }

  type Actor {
    id: ID!
    name: String!
    movies: [Movie!]! @relationship(type: "ACTED_IN", direction: IN)
  }

  type Mutation {
    notify: String!
  }

  type Subscription {
    notification: String!
  }
`;

const resolvers = {
  Mutation: {
    notify: async () => {
      await pubsub.publish(EVENT_KEY, { notification: "New movie launched!" });
      return "Notification sent!";
    },
  },
  Subscription: {
    notification: {
      subscribe: () => pubsub.asyncIterator(EVENT_KEY),
    },
  },
};

async function main() {
  const neo4jGraphQL = new Neo4jGraphQL({
    typeDefs,
    resolvers,
    driver,
    plugins: {
      subscriptions: new Neo4jGraphQLSubscriptionsSingleInstancePlugin(),
    },
  });

  const app = express();
  const httpServer = createServer(app);
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: PATH,
  });

  const schema = await neo4jGraphQL.getSchema();

  const serverCleanup = useServer(
    {
      schema,
      context: (ctx) => {
        return ctx;
      },
    },
    wsServer
  );

  const server = new ApolloServer({
    schema: schema,
    playground: true,
    plugins: [
      ApolloServerPluginDrainHttpServer({
        httpServer,
      }),
      {
        async serverWillStart() {
          return Promise.resolve({
            async drainServer() {
              await serverCleanup.dispose();
            },
          });
        },
      },
    ],
  });

  await server.start();

  app.use(
    PATH,
    cors(),
    bodyParser.json(),
    expressMiddleware(server, {
      context: async ({ req }) => ({ req }),
    })
  );

  httpServer.listen({ port: PORT }, () => {
    console.log(`GraphQL server ready at http://${HOST}:${PORT}${PATH}`);
    console.log(`Subscriptions ready at ws://${HOST}:${PORT}${PATH}`);
  });

  app.get("/ping", (req, res) => {
    res.status(200).send("pong!");
  });
}

main();
