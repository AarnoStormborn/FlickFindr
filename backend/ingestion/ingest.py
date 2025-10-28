import os
import sys

import numpy as np
import pandas as pd
import psycopg2
from dotenv import load_dotenv
from psycopg2.extras import execute_values


class PostgresIngester:
    """
    Loads data from a processed CSV file (without a 'link' column)
    into a PostgreSQL table. Assumes CSV has 'movie_name'.
    """

    def __init__(self, csv_filepath, table_name="movies"):
        """
        Initializes the ingester, loading database configuration.
        """
        load_dotenv()  # Load environment variables from .env file

        self.db_params = {
            "host": os.getenv("DB_HOST", "localhost"),
            "port": os.getenv("DB_PORT", "5432"),
            "database": os.getenv("DB_NAME"),
            "user": os.getenv("DB_USER"),
            "password": os.getenv("DB_PASSWORD"),
        }
        if not all([self.db_params["database"], self.db_params["user"], self.db_params["password"]]):
            raise ValueError(
                "Missing required database connection environment variables (DB_NAME, DB_USER, DB_PASSWORD)"
            )

        if not os.path.exists(csv_filepath):
            raise FileNotFoundError(f"CSV file not found at: {csv_filepath}")

        self.csv_filepath = csv_filepath
        self.table_name = table_name
        self.conn = None
        self.cur = None

    def _connect(self):
        """Establishes a connection to the PostgreSQL database."""
        try:
            print(f"Connecting to database '{self.db_params['database']}' on {self.db_params['host']}...")
            self.conn = psycopg2.connect(**self.db_params)
            self.cur = self.conn.cursor()
            print("Connection successful.")
        except psycopg2.OperationalError as e:
            print(f"Error connecting to PostgreSQL: {e}", file=sys.stderr)
            raise

    def _create_movies_table(self):
        """Creates the movies table if it doesn't exist, using 'movie_name'."""
        # --- Updated Schema Definition ---
        create_table_query = f"""
        CREATE TABLE IF NOT EXISTS {self.table_name} (
            id SERIAL PRIMARY KEY,
            movie_name VARCHAR(255), -- Changed from title
            rating REAL,
            runtime INTEGER,
            genre TEXT,
            metascore REAL,        -- Kept, assuming it exists in CSV
            plot TEXT,
            directors TEXT,
            stars TEXT,
            votes VARCHAR(20),
            gross VARCHAR(20),
            poster_url TEXT
        );
        """
        try:
            print(f"Ensuring table '{self.table_name}' exists...")
            self.cur.execute(create_table_query)
            self.conn.commit()
            print(f"Table '{self.table_name}' is ready.")
        except psycopg2.Error as e:
            print(f"Error creating table '{self.table_name}': {e}", file=sys.stderr)
            self.conn.rollback()
            raise

    def _ingest_csv_data(self):
        """Reads the CSV and inserts data into the PostgreSQL table."""
        try:
            print(f"Reading CSV data from '{self.csv_filepath}'...")
            df = pd.read_csv(self.csv_filepath)

            # --- Data Cleaning for DB Insertion ---
            # 1. Standardize column names
            df.columns = df.columns.str.lower().str.replace(" ", "_", regex=False).str.strip()

            # 2. Define expected table columns (excluding 'id', matching CREATE TABLE)
            #    Updated to use 'movie_name'
            expected_cols = [
                "movie_name",
                "rating",
                "runtime",
                "genre",
                "metascore",
                "plot",
                "directors",
                "stars",
                "votes",
                "gross",
                "poster_url",
                # Verify these columns exist in your final CSV after standardization
            ]

            # 3. Check for essential columns (at least movie_name might be good)
            if "movie_name" not in df.columns:
                raise ValueError("CSV must contain at least the 'movie_name' column after standardization.")

            # 4. Filter DataFrame to expected columns and handle missing ones
            missing_cols = [col for col in expected_cols if col not in df.columns]
            if missing_cols:
                print(f"Warning: CSV is missing expected columns: {missing_cols}. They will be NULL.", file=sys.stderr)
                for col in missing_cols:
                    df[col] = np.nan  # Add missing columns as NaN

            df_to_insert = df[expected_cols]  # Select only the columns for the table

            # 5. Replace pandas NaN/NaT with None for SQL NULL
            df_processed = df_to_insert.replace({np.nan: None, pd.NaT: None})

            # Convert to list of tuples
            data_tuples = [tuple(x) for x in df_processed.to_numpy()]

            if not data_tuples:
                print("No data found in the CSV to ingest.")
                return

            # --- Database Insertion ---
            print(f"Clearing existing data from '{self.table_name}'...")
            self.cur.execute(f"TRUNCATE TABLE {self.table_name} RESTART IDENTITY;")

            cols_sql = ", ".join(expected_cols)
            placeholders = ", ".join(["%s"] * len(expected_cols))
            insert_query = f"INSERT INTO {self.table_name} ({cols_sql}) VALUES %s"

            print(f"Inserting {len(data_tuples)} rows into '{self.table_name}'...")
            execute_values(self.cur, insert_query, data_tuples)

            self.conn.commit()
            print("Data ingestion successful.")

        except pd.errors.EmptyDataError:
            print(f"Warning: CSV file '{self.csv_filepath}' is empty.", file=sys.stderr)
        except FileNotFoundError:
            print(f"Error: CSV file not found at '{self.csv_filepath}'", file=sys.stderr)
            raise
        except (psycopg2.Error, ValueError) as e:  # Catch DB errors and ValueErrors (like missing movie_name)
            print(f"Error during ingestion: {e}", file=sys.stderr)
            if self.conn:
                self.conn.rollback()
            raise
        except Exception as e:
            print(f"An unexpected error occurred during ingestion: {e}", file=sys.stderr)
            if self.conn:
                self.conn.rollback()
            raise

    def run(self):
        """Runs the complete ingestion process."""
        try:
            self._connect()
            self._create_movies_table()
            self._ingest_csv_data()
        except Exception as e:
            print(f"Ingestion failed: {e}", file=sys.stderr)
            # sys.exit(1) # Optional exit on failure
        finally:
            if self.cur:
                self.cur.close()
            if self.conn:
                self.conn.close()
                print("Database connection closed.")


if __name__ == "__main__":
    # --- Configuration ---
    # Ensure this points to your final processed CSV file (the one without 'link')
    CSV_FILE = "ingestion/data/final.csv"  # Make sure this is the correct filename
    # ---------------------

    try:
        # Check for DB env vars before initializing
        if not all([os.getenv("DB_NAME"), os.getenv("DB_USER"), os.getenv("DB_PASSWORD")]):
            raise ValueError("Missing required DB environment variables.")
        if not os.path.exists(CSV_FILE):
            raise FileNotFoundError(f"Input CSV file not found: {CSV_FILE}")

        ingester = PostgresIngester(csv_filepath=CSV_FILE)
        ingester.run()
    except (ValueError, FileNotFoundError) as init_error:
        print(f"Initialization failed: {init_error}", file=sys.stderr)
        sys.exit(1)
    except Exception as run_error:
        print(f"An error occurred during the run: {run_error}", file=sys.stderr)
        sys.exit(1)
