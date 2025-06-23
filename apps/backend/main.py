from time import sleep

def main():
    print("Hello from app!")


if __name__ == "__main__":
    count = 0
    while True:
        print(f"Hello from app {count}", flush=True)
        count += 1
        sleep(5)
